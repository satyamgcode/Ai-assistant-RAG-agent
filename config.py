import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Base directories
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
STATIC_DIR = os.path.join(BASE_DIR, "static")

# Database configuration
DB_PATH = os.path.join(DATA_DIR, "vector_store.db")

# API Keys and Model Configuration
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
DEFAULT_EMBEDDING_MODEL = "models/gemini-embedding-001"
DEFAULT_LLM_MODEL = "gemini-2.5-flash"  # or gemini-2.5-flash

# Ensure required directories exist
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)

def get_api_key():
    """Retrieve API key from config or environment."""
    return os.getenv("GEMINI_API_KEY", GEMINI_API_KEY)
