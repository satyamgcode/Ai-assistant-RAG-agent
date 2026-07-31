import google.generativeai as genai
import config

def configure_gemini(api_key=None):
    """Configure the Generative AI library with the provided key or fallback."""
    key = api_key if api_key else config.get_api_key()
    if not key:
        raise ValueError("Google Gemini API Key is missing. Please configure it in Settings or your .env file.")
    genai.configure(api_key=key)

def get_embedding(text, api_key=None):
    """Generate text embeddings using embedding-001 (or fallback if config fails)."""
    configure_gemini(api_key)
    try:
        response = genai.embed_content(
            model=config.DEFAULT_EMBEDDING_MODEL,
            content=text,
            task_type="retrieval_document"
        )
        return response['embedding']
    except Exception as e:
        # Fallback to models/gemini-embedding-001 if the configured model failed
        if config.DEFAULT_EMBEDDING_MODEL != "models/gemini-embedding-001":
            try:
                print(f"[WARNING] Model {config.DEFAULT_EMBEDDING_MODEL} failed, attempting fallback to models/gemini-embedding-001...")
                response = genai.embed_content(
                    model="models/gemini-embedding-001",
                    content=text,
                    task_type="retrieval_document"
                )
                return response['embedding']
            except Exception as inner_e:
                raise RuntimeError(f"Embedding generation failed for both configured and fallback models. Error: {str(inner_e)}")
        raise RuntimeError(f"Error generating embedding: {str(e)}")

def generate_answer(query, context_chunks, api_key=None, model_name=config.DEFAULT_LLM_MODEL, chat_history=None):
    """
    Generate an answer using retrieved chunks as context.
    chat_history: list of dicts: [{'role': 'user'|'model', 'text': str}]
    """
    configure_gemini(api_key)
    
    # Format retrieved context
    formatted_context = ""
    for idx, chunk in enumerate(context_chunks):
        formatted_context += f"\n[Document: {chunk['filename']} | Match Rank: {idx+1} | Match Score: {chunk['score']:.2f}]\n"
        formatted_context += f"{chunk['text']}\n"
        formatted_context += "-" * 40 + "\n"

    # Define system instruction
    system_instruction = (
        "You are an expert HR AI Agent and Employee Handbook Assistant. "
        "Your task is to help employees and managers understand the company's policies, guidelines, "
        "and handbook terms based strictly on the provided document context.\n\n"
        "Instructions:\n"
        "1. Base your answer solely on the retrieved context below. Do not make up facts, urls, email addresses, "
        "or policy details. If a policy is not mentioned in the context, clearly state: "
        "'I cannot find this information in the currently uploaded policy documents. Please contact your HR representative.'\n"
        "2. Cite the source document name (e.g. 'According to the Employee Conduct Policy...') when referencing details.\n"
        "3. Provide a clear, professional, structured response. Use bullet points and bold text where appropriate.\n"
        "4. Be friendly but maintain an official, professional tone."
    )

    # Format the prompt
    prompt = f"""
Here is the retrieved context from the company's policies and handbook:
=========================================
{formatted_context}
=========================================

Conversation History:
"""
    if chat_history:
        for msg in chat_history:
            role_label = "User" if msg['role'] == 'user' else "Assistant"
            prompt += f"{role_label}: {msg['text']}\n"
            
    prompt += f"\nCurrent Question: {query}\n"
    prompt += "Answer:"

    try:
        model = genai.GenerativeModel(
            model_name=model_name,
            system_instruction=system_instruction
        )
        response = model.generate_content(
            prompt,
            generation_config=genai.types.GenerationConfig(
                temperature=0.1,
                max_output_tokens=1024
            )
        )
        return response.text
    except Exception as e:
        raise RuntimeError(f"Gemini LLM generation failed: {str(e)}")

def analyze_full_document(filename, full_text, api_key=None, model_name=config.DEFAULT_LLM_MODEL):
    """Perform direct metadata and overview summary analysis on an uploaded document."""
    configure_gemini(api_key)
    
    system_instruction = (
        "You are an expert Document Analysis AI Agent. "
        "Analyze the uploaded document and return a detailed, beautiful overview report."
    )
    
    prompt = f"""
Please analyze the document '{filename}' and compile a clear summary report.
Provide the output in clean, professional markdown format, containing:
1. **Document Overview**: A brief summary of what this document is.
2. **Key Highlights**: Bullet points listing the critical rules, terms, or policies contained.
3. **Important Dates or Conditions**: Mention if there are deadlines, eligibility requirements, or specific dates.
4. **Suggested Questions**: List 3-4 specific sample questions employees might ask about this document.

Here is the document text:
=========================================
{full_text[:40000]} # Limit to first 40k characters to stay within safety margins
=========================================
"""
    try:
        model = genai.GenerativeModel(
            model_name=model_name,
            system_instruction=system_instruction
        )
        response = model.generate_content(prompt)
        return response.text
    except Exception as e:
        return f"⚠️ Could not automatically generate a summary analysis report: {str(e)}"
