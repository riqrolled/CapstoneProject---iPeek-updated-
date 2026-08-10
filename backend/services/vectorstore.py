"""
services/vectorstore.py
------------------------
ChromaDB access wrapped as a class, per the project's OOP requirement.
Embeddings now come from FastEmbed instead of HuggingFace — same
BAAI/bge-m3 model, ONNX runtime backend.

Loaded once at import time (module-level singleton).

All public methods are async — they wrap the underlying synchronous
chromadb/fastembed calls in a thread via asyncio.to_thread(), so a slow
embedding/query never blocks FastAPI's event loop.
"""
import asyncio
import logging

from langchain_community.embeddings import FastEmbedEmbeddings
from langchain_chroma import Chroma

from config import CHROMA_DIR, CHROMA_COLLECTION, EMBEDDING_MODEL

logger = logging.getLogger(__name__)


class VectorStoreService:
    def __init__(self):
        logger.info(f"Loading FastEmbed embedding model: {EMBEDDING_MODEL}")
        self._embeddings = FastEmbedEmbeddings(model_name=EMBEDDING_MODEL)
        self._store = Chroma(
            collection_name=CHROMA_COLLECTION,
            embedding_function=self._embeddings,
            persist_directory=CHROMA_DIR,
            collection_metadata={"hnsw:space": "cosine"},
        )
        logger.info(f"ChromaDB ready — collection: {CHROMA_COLLECTION}")

    async def add_documents(self, documents: list) -> None:
        await asyncio.to_thread(self._store.add_documents, documents)

    async def delete_by_source(self, source: str) -> int:
        def _delete():
            results = self._store.get(where={"source": source})
            ids = results.get("ids", [])
            if ids:
                self._store.delete(ids=ids)
            return len(ids)
        count = await asyncio.to_thread(_delete)
        logger.info(f"Deleted {count} chunks for source '{source}'")
        return count

    async def get_chunk_count(self) -> int:
        def _count():
            try:
                return self._store._collection.count()
            except Exception as e:
                logger.error(f"Chunk count failed: {e}")
                return 0
        return await asyncio.to_thread(_count)

    async def similarity_search(
        self, query: str, k: int, approved_sources: set, score_threshold: float
    ) -> list:
        def _search():
            if not approved_sources:
                return []
            docs_and_scores = self._store.similarity_search_with_relevance_scores(
                query, k=k, filter={"source": {"$in": list(approved_sources)}}
            )
            return [doc for doc, score in docs_and_scores if score >= score_threshold]
        return await asyncio.to_thread(_search)


# Module-level singleton — created once at import, reused across requests
vectorstore_service = VectorStoreService()