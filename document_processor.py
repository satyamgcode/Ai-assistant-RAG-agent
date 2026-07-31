import os
import re
from pypdf import PdfReader

def extract_text_from_pdf(file_path):
    """Extract raw text from a PDF file."""
    reader = PdfReader(file_path)
    text = ""
    for page_idx, page in enumerate(reader.pages):
        page_text = page.extract_text()
        if page_text:
            text += f"\n--- Page {page_idx + 1} ---\n{page_text}"
    return text

def extract_text_from_file(file_path):
    """Extract text from TXT, MD, or PDF files."""
    ext = os.path.splitext(file_path)[1].lower()
    if ext == ".pdf":
        return extract_text_from_pdf(file_path)
    elif ext in [".txt", ".md", ".markdown"]:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()
    else:
        raise ValueError(f"Unsupported file format: {ext}")

def split_text_into_chunks(text, chunk_size=800, overlap=80):
    """
    Split text into logical chunks.
    Maintains semantic context by splitting on paragraphs, then lines, then sentences, then words.
    """
    if not text:
        return []

    # Clean up excessive whitespace
    text = re.sub(r'\r\n', '\n', text)
    text = re.sub(r' +', ' ', text)
    
    # Simple recursive splitting implementation
    def split_rec(text_part, separators):
        if len(text_part) <= chunk_size or not separators:
            return [text_part]
            
        sep = separators[0]
        parts = text_part.split(sep)
        
        chunks = []
        current_segment = ""
        
        for part in parts:
            # Handle empty parts from consecutive separators
            if not part and sep != "":
                continue
                
            # If a single part is already too large, recurse with next level separators
            if len(part) > chunk_size:
                if current_segment:
                    chunks.append(current_segment)
                    current_segment = ""
                sub_chunks = split_rec(part, separators[1:])
                chunks.extend(sub_chunks)
            else:
                proposed = current_segment + (sep if current_segment else "") + part
                if len(proposed) <= chunk_size:
                    current_segment = proposed
                else:
                    if current_segment:
                        chunks.append(current_segment)
                    current_segment = part
                    
        if current_segment:
            chunks.append(current_segment)
            
        return chunks

    # List of separators from most semantic to least semantic
    # Paragraph, Line break, Sentence boundary, Word boundary, empty character
    seps = ["\n\n", "\n", ". ", " ", ""]
    raw_chunks = split_rec(text, seps)
    
    # Post-process to merge and apply overlap
    processed_chunks = []
    for i, raw in enumerate(raw_chunks):
        cleaned = raw.strip()
        if not cleaned:
            continue
            
        # If not the first chunk, prefix with overlap from previous chunk
        if i > 0 and overlap > 0:
            prev_raw = raw_chunks[i-1]
            overlap_text = prev_raw[-overlap:] if len(prev_raw) > overlap else prev_raw
            # Remove partial words if possible
            first_space = overlap_text.find(" ")
            if first_space != -1 and first_space < len(overlap_text) - 1:
                overlap_text = overlap_text[first_space+1:]
            
            chunk_with_overlap = f"... {overlap_text.strip()} [overlap] ...\n{cleaned}"
        else:
            chunk_with_overlap = cleaned
            
        processed_chunks.append(chunk_with_overlap)
        
    return processed_chunks
