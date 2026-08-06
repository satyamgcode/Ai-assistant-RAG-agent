import os
import uuid
import shutil
import hashlib
import secrets
import re
from datetime import datetime, timedelta
from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException, Depends
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

class AuthRequest(BaseModel):
    email: str
    password: str

class RegisterRequest(BaseModel):
    email: str
    password: str
    confirm_password: str

# Password hashing helpers
def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 100000)
    return salt.hex() + ":" + key.hex()

def verify_password(password: str, hashed: str) -> bool:
    try:
        salt_hex, key_hex = hashed.split(":")
        salt = bytes.fromhex(salt_hex)
        key = bytes.fromhex(key_hex)
        new_key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 100000)
        return secrets.compare_digest(key, new_key)
    except Exception:
        return False

# Email format check
def is_valid_email(email: str) -> bool:
    regex = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(regex, email))

# Auth Dependency
async def get_current_user(
    authorization: Optional[str] = Header(None),
    x_session_token: Optional[str] = Header(None)
):
    token = None
    if x_session_token:
        token = x_session_token
    elif authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ")[1]
        
    if not token:
        raise HTTPException(status_code=401, detail="Authentication session token required.")
        
    session = vector_db.get_session(token)
    if not session:
        raise HTTPException(status_code=401, detail="Session expired or invalid.")
        
    try:
        expires_at = datetime.fromisoformat(session["expires_at"])
        if datetime.now() > expires_at:
            vector_db.delete_session(token)
            raise HTTPException(status_code=401, detail="Session expired.")
    except Exception:
        pass
        
    return session

# Auth Endpoints

@app.post("/api/auth/register")
def register_user(request: RegisterRequest):
    email = request.email.strip().lower()
    password = request.password
    confirm_password = request.confirm_password
    
    if not is_valid_email(email):
        raise HTTPException(status_code=400, detail="Invalid email address format.")
        
    if len(password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters long.")
        
    if password != confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match.")
        
    existing_user = vector_db.get_user_by_email(email)
    if existing_user:
        raise HTTPException(status_code=400, detail="This email is already registered. Please log in.")
        
    user_id = str(uuid.uuid4())
    chatbot_id = "cb_" + secrets.token_hex(6)
    password_hash = hash_password(password)
    
    try:
        vector_db.create_user(user_id, email, password_hash, chatbot_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create user: {str(e)}")
        
    # Auto-login
    token = secrets.token_hex(24)
    expires_at = (datetime.now() + timedelta(days=30)).isoformat()
    vector_db.create_session(token, user_id, chatbot_id, expires_at)
    
    return {
        "success": True,
        "token": token,
        "email": email,
        "chatbot_id": chatbot_id
    }

@app.post("/api/auth/login")
def login_user(request: AuthRequest):
    email = request.email.strip().lower()
    password = request.password
    
    user = vector_db.get_user_by_email(email)
    if not user or not verify_password(password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
        
    token = secrets.token_hex(24)
    expires_at = (datetime.now() + timedelta(days=30)).isoformat()
    vector_db.create_session(token, user["id"], user["chatbot_id"], expires_at)
    
    return {
        "success": True,
        "token": token,
        "email": user["email"],
        "chatbot_id": user["chatbot_id"]
    }

@app.post("/api/auth/logout")
def logout_user(current_user: dict = Depends(get_current_user), x_session_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    token = x_session_token
    if not token and authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ")[1]
        
    if token:
        vector_db.delete_session(token)
    return {"success": True, "message": "Logged out successfully."}

@app.get("/api/auth/me")
def get_me(current_user: dict = Depends(get_current_user)):
    user_info = vector_db.get_user_by_id(current_user["user_id"])
    if not user_info:
        raise HTTPException(status_code=404, detail="User not found.")
    return {
        "email": user_info["email"],
        "chatbot_id": user_info["chatbot_id"],
        "has_custom_api_key": bool(user_info.get("api_key"))
    }

# Admin Settings Endpoints

@app.get("/api/settings")
def get_user_settings(current_user: dict = Depends(get_current_user)):
    """Retrieve user configurations."""
    user_info = vector_db.get_user_by_id(current_user["user_id"])
    if not user_info:
        raise HTTPException(status_code=404, detail="User not found.")
    return {
        "api_key": user_info.get("api_key", ""),
        "chatbot_id": current_user["chatbot_id"],
        "has_global_key": bool(config.get_api_key())
    }

@app.post("/api/settings")
def save_user_settings(request: SettingsRequest, current_user: dict = Depends(get_current_user)):
    """Save API key to user record."""
    try:
        vector_db.update_user_api_key(current_user["user_id"], request.api_key.strip())
        return {"success": True, "message": "Settings saved successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Indexing & Documents Endpoints

@app.get("/api/stats")
def get_stats(current_user: dict = Depends(get_current_user)):
    """Retrieve indexing statistics for the authenticated user's chatbot."""
    try:
        chatbot_id = current_user["chatbot_id"]
        stats = vector_db.get_stats(chatbot_id=chatbot_id)
        
        # Calculate size of documents belonging to this chatbot
        docs = vector_db.get_documents(chatbot_id=chatbot_id)
        uploads_size = sum(doc["file_size"] for doc in docs)
        stats["uploads_size_bytes"] = uploads_size
        return stats
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/documents")
def list_documents(current_user: dict = Depends(get_current_user)):
    """Get all documents currently indexed for the authenticated user's chatbot."""
    try:
        chatbot_id = current_user["chatbot_id"]
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
    current_user: dict = Depends(get_current_user)
):
    """
    Upload a document, extract text, chunk it, generate embeddings,
    and save raw content + vector references.
    """
    # Validation checks
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".pdf", ".txt", ".md", ".docx"]:
        raise HTTPException(status_code=400, detail="Only PDF, TXT, Markdown, and DOCX files are supported.")

    doc_id = str(uuid.uuid4())
    filename = file.filename
    temp_file_path = os.path.join(config.UPLOAD_DIR, f"{doc_id}{ext}")
    chatbot_id = current_user["chatbot_id"]
    
    # Resolve API Key
    user_info = vector_db.get_user_by_id(current_user["user_id"])
    resolved_api_key = api_key if api_key else user_info.get("api_key")
    if not resolved_api_key:
        resolved_api_key = config.get_api_key()
        
    if not resolved_api_key:
        raise HTTPException(
            status_code=400,
            detail="Gemini API Key is missing. Please configure it in settings."
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
def delete_document(doc_id: str, current_user: dict = Depends(get_current_user)):
    """Remove document from filesystem, SQLite database, and delete its analysis report."""
    try:
        chatbot_id = current_user["chatbot_id"]
        # Retrieve document metadata first to get filename and check ownership
        docs = vector_db.get_documents(chatbot_id=chatbot_id)
        target_doc = next((d for d in docs if d["id"] == doc_id), None)
        
        if not target_doc:
            raise HTTPException(status_code=404, detail="Document not found or access denied.")

        # Delete database entries with ownership check
        vector_db.delete_document(doc_id, chatbot_id=chatbot_id)

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
def get_document_analysis(doc_id: str, current_user: dict = Depends(get_current_user)):
    """Fetch the generated markdown analysis report of the document."""
    chatbot_id = current_user["chatbot_id"]
    # Check ownership
    docs = vector_db.get_documents(chatbot_id=chatbot_id)
    target_doc = next((d for d in docs if d["id"] == doc_id), None)
    if not target_doc:
        raise HTTPException(status_code=404, detail="Document not found or access denied.")

    analysis_path = os.path.join(config.DATA_DIR, f"analysis_{doc_id}.md")
    if not os.path.exists(analysis_path):
        raise HTTPException(status_code=404, detail="Analysis report not found for this document.")
        
    try:
        with open(analysis_path, "r", encoding="utf-8") as f:
            content = f.read()
        return {"document_id": doc_id, "analysis_report": content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Public Widget Chat Endpoint

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
    
    # 1. Validate chatbot_id
    chatbot_id = request.chatbot_id
    if not chatbot_id or not vector_db.validate_chatbot_id(chatbot_id):
        raise HTTPException(status_code=404, detail="Chatbot instance not found.")
        
    # 2. Resolve API key
    user_info = vector_db.get_user_by_chatbot_id(chatbot_id)
    resolved_api_key = x_api_key if x_api_key else (user_info.get("api_key") if user_info else None)
    if not resolved_api_key:
        resolved_api_key = config.get_api_key()
        
    if not resolved_api_key:
        raise HTTPException(
            status_code=400,
            detail="Gemini API Key is missing. Please configure it in settings."
        )

    try:
        # 1. Embed query
        query_emb = ai_agent.get_embedding(query, resolved_api_key)
        
        # 2. Retrieve top matching chunks
        matches = vector_db.search_similar_chunks(query_emb, chatbot_id=chatbot_id, limit=4)
        
        if not matches:
            return {
                "answer": "Hi! I don't see any policy documents uploaded yet. Please upload a policy or handbook document first in the dashboard so I can reference it!",
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
