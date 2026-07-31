import sqlite3
import json
import numpy as np
import os
from datetime import datetime
from config import DB_PATH

class VectorStore:
    def __init__(self, db_path=DB_PATH):
        self.db_path = db_path
        self.init_db()

    def init_db(self):
        """Initialize the database tables for documents and vectorized chunks."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Table 1: Documents metadata with chatbot_id
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            chatbot_id TEXT NOT NULL DEFAULT 'default',
            filename TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            chunk_count INTEGER NOT NULL,
            uploaded_at TEXT NOT NULL
        )
        """)

        # Schema migration: Add chatbot_id if table exists but doesn't have it
        try:
            cursor.execute("ALTER TABLE documents ADD COLUMN chatbot_id TEXT DEFAULT 'default'")
        except sqlite3.OperationalError:
            pass # Column already exists

        # Table 2: Chunks and embeddings
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS chunks (
            id TEXT PRIMARY KEY,
            document_id TEXT,
            chunk_index INTEGER NOT NULL,
            text TEXT NOT NULL,
            embedding BLOB NOT NULL,
            FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
        )
        """)

        conn.commit()
        conn.close()

    def add_document(self, doc_id, filename, file_size, chunk_count, chatbot_id="default"):
        """Register an uploaded document."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        uploaded_at = datetime.now().isoformat()
        
        # Remove any existing document with same ID to prevent constraint errors
        cursor.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
        
        cursor.execute(
            "INSERT INTO documents (id, chatbot_id, filename, file_size, chunk_count, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)",
            (doc_id, chatbot_id, filename, file_size, chunk_count, uploaded_at)
        )
        conn.commit()
        conn.close()

    def add_chunks(self, doc_id, chunks_data):
        """
        Store text chunks and their embeddings.
        chunks_data list of dicts: {'text': str, 'embedding': list[float], 'index': int}
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        for chunk in chunks_data:
            chunk_id = f"{doc_id}_{chunk['index']}"
            # Convert embedding to float32 binary blob
            emb_array = np.array(chunk['embedding'], dtype=np.float32)
            emb_blob = emb_array.tobytes()
            
            cursor.execute(
                "INSERT INTO chunks (id, document_id, chunk_index, text, embedding) VALUES (?, ?, ?, ?, ?)",
                (chunk_id, doc_id, chunk['index'], chunk['text'], emb_blob)
            )
            
        conn.commit()
        conn.close()

    def delete_document(self, doc_id):
        """Remove document and its vector representations."""
        conn = sqlite3.connect(self.db_path)
        # Enable foreign key support in SQLite to cascade delete chunks
        conn.execute("PRAGMA foreign_keys = ON")
        cursor = conn.cursor()
        cursor.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
        conn.commit()
        conn.close()

    def get_documents(self, chatbot_id=None):
        """Get list of active documents, optionally filtered by a specific chatbot."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        if chatbot_id:
            cursor.execute("SELECT id, filename, file_size, chunk_count, uploaded_at FROM documents WHERE chatbot_id = ? ORDER BY uploaded_at DESC", (chatbot_id,))
        else:
            cursor.execute("SELECT id, filename, file_size, chunk_count, uploaded_at FROM documents ORDER BY uploaded_at DESC")
        rows = cursor.fetchall()
        conn.close()
        
        docs = []
        for r in rows:
            docs.append({
                "id": r[0],
                "filename": r[1],
                "file_size": r[2],
                "chunk_count": r[3],
                "uploaded_at": r[4]
            })
        return docs

    def get_stats(self, chatbot_id="default"):
        """Retrieve database statistics for a specific chatbot."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("SELECT COUNT(*) FROM documents WHERE chatbot_id = ?", (chatbot_id,))
        doc_count = cursor.fetchone()[0]
        
        cursor.execute("""
            SELECT COUNT(*) FROM chunks c
            JOIN documents d ON c.document_id = d.id
            WHERE d.chatbot_id = ?
        """, (chatbot_id,))
        chunk_count = cursor.fetchone()[0]
        
        conn.close()
        
        db_size = 0
        if os.path.exists(self.db_path):
            db_size = os.path.getsize(self.db_path)
            
        return {
            "document_count": doc_count,
            "chunk_count": chunk_count,
            "db_size_bytes": db_size
        }

    def search_similar_chunks(self, query_embedding, chatbot_id="default", limit=5):
        """
        Find top matches using cosine similarity in NumPy, filtered by chatbot_id.
        Returns list of dicts: {'text': str, 'filename': str, 'score': float}
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Join chunks with documents to get filenames, filtered by chatbot_id
        cursor.execute("""
            SELECT c.text, c.embedding, d.filename, c.chunk_index
            FROM chunks c
            JOIN documents d ON c.document_id = d.id
            WHERE d.chatbot_id = ?
        """, (chatbot_id,))
        rows = cursor.fetchall()
        conn.close()

        if not rows:
            return []

        query_vector = np.array(query_embedding, dtype=np.float32)
        q_norm = np.linalg.norm(query_vector)
        if q_norm == 0:
            return []

        results = []
        for text, emb_blob, filename, idx in rows:
            # Reconstruct numpy array from float32 blob
            chunk_vector = np.frombuffer(emb_blob, dtype=np.float32)
            
            # Compute cosine similarity
            c_norm = np.linalg.norm(chunk_vector)
            if c_norm == 0:
                continue
                
            similarity = np.dot(chunk_vector, query_vector) / (c_norm * q_norm)
            
            results.append({
                "text": text,
                "filename": filename,
                "chunk_index": idx,
                "score": float(similarity)
            })

        # Sort by similarity score descending
        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:limit]
