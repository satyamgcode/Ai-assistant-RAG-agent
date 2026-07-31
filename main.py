import os
import uuid
import shutil
from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from typing import List, Optional

import config
from vector_store import VectorStore
import document_processor
import ai_agent

# Initialize FastAPI App
app = FastAPI(
    title="AI Policy & Employee Handbook Assistant API",
    description="Backend API for vector-indexing HR documents and answering natural language policy queries."
)

# Enable CORS for cross-origin frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize SQLite database
vector_db = VectorStore()

# Pydantic Schemas
class ChatMessage(BaseModel):
    role: str
    text: str

class ChatRequest(BaseModel):
    query: str
    chat_history: Optional[List[ChatMessage]] = []
    model: Optional[str] = config.DEFAULT_LLM_MODEL
    chatbot_id: Optional[str] = "default"

class SettingsRequest(BaseModel):
    api_key: str

# Endpoints

@app.get("/api/settings")
def get_backend_settings():
    """Retrieve backend configurations."""
    return {"api_key": config.get_api_key()}

@app.post("/api/settings")
def save_backend_settings(request: SettingsRequest):
    """Save API key to backend .env file."""
    try:
        env_path = os.path.join(config.BASE_DIR, ".env")
        lines = []
        if os.path.exists(env_path):
            with open(env_path, "r", encoding="utf-8") as f:
                lines = f.readlines()
        
        found = False
        new_lines = []
        for line in lines:
            if line.strip().startswith("GEMINI_API_KEY="):
                new_lines.append(f"GEMINI_API_KEY={request.api_key}\n")
                found = True
            else:
                new_lines.append(line)
        if not found:
            new_lines.append(f"GEMINI_API_KEY={request.api_key}\n")
            
        with open(env_path, "w", encoding="utf-8") as f:
            f.writelines(new_lines)
            
        os.environ["GEMINI_API_KEY"] = request.api_key
        config.GEMINI_API_KEY = request.api_key
        return {"success": True, "message": "Settings saved successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/stats")
def get_stats(chatbot_id: str = "default"):
    """Retrieve indexing statistics."""
    try:
        stats = vector_db.get_stats(chatbot_id=chatbot_id)
        # Add uploads directory size
        uploads_size = 0
        for f in os.listdir(config.UPLOAD_DIR):
            fp = os.path.join(config.UPLOAD_DIR, f)
            if os.path.isfile(fp):
                uploads_size += os.path.getsize(fp)
        stats["uploads_size_bytes"] = uploads_size
        return stats
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/documents")
def list_documents(chatbot_id: str = "default"):
    """Get all documents currently indexed."""
    try:
        docs = vector_db.get_documents(chatbot_id=chatbot_id)
        # Check if analysis report exists for each document
        for doc in docs:
            analysis_path = os.path.join(config.DATA_DIR, f"analysis_{doc['id']}.md")
            doc["has_analysis"] = os.path.exists(analysis_path)
        return docs
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/upload")
async def upload_document(
    file: UploadFile = File(...),
    api_key: Optional[str] = Form(None),
    chatbot_id: str = Form("default")
):
    """
    Upload a document, extract text, chunk it, generate embeddings,
    and save raw content + vector references.
    """
    # Validation checks
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".pdf", ".txt", ".md"]:
        raise HTTPException(status_code=400, detail="Only PDF, TXT, and Markdown files are supported.")

    doc_id = str(uuid.uuid4())
    filename = file.filename
    temp_file_path = os.path.join(config.UPLOAD_DIR, f"{doc_id}{ext}")
    
    # Resolve API Key
    resolved_api_key = api_key if api_key else config.get_api_key()
    if not resolved_api_key:
        raise HTTPException(
            status_code=400,
            detail="Gemini API Key is missing. Please configure it in settings or the .env file."
        )

    try:
        # 1. Save uploaded file to disk
        with open(temp_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        file_size = os.path.getsize(temp_file_path)

        # 2. Extract raw text
        raw_text = document_processor.extract_text_from_file(temp_file_path)
        if not raw_text.strip():
            raise ValueError("The uploaded document contains no readable text content.")

        # 3. Create document chunks
        chunks = document_processor.split_text_into_chunks(raw_text)
        chunk_count = len(chunks)
        if chunk_count == 0:
            raise ValueError("Failed to split text into logical sections.")

        # 4. Generate embeddings for chunks & build data list
        chunks_data = []
        for idx, chunk_text in enumerate(chunks):
            embedding = ai_agent.get_embedding(chunk_text, resolved_api_key)
            chunks_data.append({
                "text": chunk_text,
                "embedding": embedding,
                "index": idx
            })

        # 5. Save document and chunks to SQLite
        vector_db.add_document(doc_id, filename, file_size, chunk_count, chatbot_id=chatbot_id)
        vector_db.add_chunks(doc_id, chunks_data)

        # 6. Generate background Analysis report
        analysis_report = ai_agent.analyze_full_document(filename, raw_text, resolved_api_key)
        analysis_path = os.path.join(config.DATA_DIR, f"analysis_{doc_id}.md")
        with open(analysis_path, "w", encoding="utf-8") as f:
            f.write(analysis_report)

        return {
            "success": True,
            "document_id": doc_id,
            "filename": filename,
            "chunks_created": chunk_count,
            "has_analysis": True
        }

    except Exception as e:
        # Cleanup files on failure
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)
        
        # Diagnostics block to identify supported embedding models
        diagnostics = ""
        try:
            import google.generativeai as genai
            genai.configure(api_key=resolved_api_key)
            avail_models = []
            for m in genai.list_models():
                if 'embedContent' in m.supported_generation_methods:
                    avail_models.append(m.name)
            if avail_models:
                diagnostics = f" Supported embedding models: {', '.join(avail_models)}."
            else:
                diagnostics = " No embedding models reported as supported by this API key."
        except Exception as diag_err:
            diagnostics = f" (Diagnostics query failed: {str(diag_err)})"

        raise HTTPException(status_code=500, detail=f"Indexing failed: {str(e)}.{diagnostics}")

@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: str):
    """Remove document from filesystem, SQLite database, and delete its analysis report."""
    try:
        # Find document details
        docs = vector_db.get_documents()
        target_doc = next((d for d in docs if d["id"] == doc_id), None)
        
        if not target_doc:
            raise HTTPException(status_code=404, detail="Document not found.")

        # Delete database entries
        vector_db.delete_document(doc_id)

        # Delete raw file from disk
        filename = target_doc["filename"]
        ext = os.path.splitext(filename)[1].lower()
        file_path = os.path.join(config.UPLOAD_DIR, f"{doc_id}{ext}")
        if os.path.exists(file_path):
            os.remove(file_path)

        # Delete analysis report
        analysis_path = os.path.join(config.DATA_DIR, f"analysis_{doc_id}.md")
        if os.path.exists(analysis_path):
            os.remove(analysis_path)

        return {"success": True, "message": f"Document '{filename}' deleted successfully."}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/documents/{doc_id}/analysis")
def get_document_analysis(doc_id: str):
    """Fetch the generated markdown analysis report of the document."""
    analysis_path = os.path.join(config.DATA_DIR, f"analysis_{doc_id}.md")
    if not os.path.exists(analysis_path):
        raise HTTPException(status_code=404, detail="Analysis report not found for this document.")
        
    try:
        with open(analysis_path, "r", encoding="utf-8") as f:
            content = f.read()
        return {"document_id": doc_id, "analysis_report": content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/chat")
async def chat_with_agent(
    request: ChatRequest,
    x_api_key: Optional[str] = Header(None)
):
    """
    RAG Chat endpoint. Searches SQLite for similar policy chunks
    and sends them to Gemini LLM to construct an answer.
    """
    query = request.query
    history = [h.dict() for h in request.chat_history] if request.chat_history else []
    
    # Resolve API key
    resolved_api_key = x_api_key if x_api_key else config.get_api_key()
    if not resolved_api_key:
        raise HTTPException(
            status_code=400,
            detail="Gemini API Key is missing. Please configure it in settings or the .env file."
        )

    try:
        # 1. Embed query
        query_emb = ai_agent.get_embedding(query, resolved_api_key)
        
        # 2. Retrieve top matching chunks
        matches = vector_db.search_similar_chunks(query_emb, chatbot_id=request.chatbot_id, limit=4)
        
        if not matches:
            return {
                "answer": "Meow! I don't see any policy documents uploaded yet. Please upload a policy or handbook document first in the dashboard so I can reference it!",
                "context": []
            }

        # 3. Generate answer via Gemini
        answer = ai_agent.generate_answer(
            query=query,
            context_chunks=matches,
            api_key=resolved_api_key,
            model_name=request.model,
            chat_history=history
        )

        return {
            "answer": answer,
            "context": matches
        }

    except Exception as e:
        # Diagnostics block to identify supported chat models
        diagnostics = ""
        try:
            import google.generativeai as genai
            genai.configure(api_key=resolved_api_key)
            avail_models = []
            for m in genai.list_models():
                if 'generateContent' in m.supported_generation_methods:
                    avail_models.append(m.name)
            if avail_models:
                diagnostics = f" Supported generation models: {', '.join(avail_models)}."
            else:
                diagnostics = " No generation models reported as supported by this API key."
        except Exception as diag_err:
            diagnostics = f" (Diagnostics query failed: {str(diag_err)})"

        raise HTTPException(status_code=500, detail=f"{str(e)}.{diagnostics}")

# Serve Standalone Dashboard HTML files

@app.get("/")
def read_index():
    """Serve the root dashboard file."""
    index_file = os.path.join(config.STATIC_DIR, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return JSONResponse(status_code=404, content={"detail": "static/index.html not found"})

# Mount static folder for CSS and JS assets
app.mount("/", StaticFiles(directory=config.STATIC_DIR), name="static")
