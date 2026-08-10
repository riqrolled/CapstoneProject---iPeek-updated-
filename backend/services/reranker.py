"""
services/reranker.py
---------------------
Cross-encoder re-ranker (BAAI/bge-reranker-v2-m3), wrapped as a class.
Async wrapper around sentence-transformers' CrossEncoder — the model
itself is still synchronous/CPU-bound, so predict() runs in a thread
via asyncio.to_thread so it never blocks FastAPI's event loop.

NOTE: currently using sentence-transformers, matching your existing
model choice exactly. FastEmbed also supports BAAI/bge-reranker-v2-m3
via its TextCrossEncoder class if you want to switch this too later
for the same CPU-speed reasons as the embedding swap — flagging as an
option, not applied here since you only asked to switch embeddings.
"""
import asyncio
import logging

from sentence_transformers import CrossEncoder
from config import RERANKER_MODEL, RERANK_TOP_K

logger = logging.getLogger(__name__)


class RerankerService:
    def __init__(self):
        logger.info(f"Loading re-ranker: {RERANKER_MODEL}")
        self._model = CrossEncoder(RERANKER_MODEL, max_length=512)
        logger.info("Re-ranker ready.")

    async def rerank(self, query: str, documents: list) -> list:
        if not documents:
            return []

        def _score():
            pairs = [(query, doc.page_content) for doc in documents]
            scores = self._model.predict(pairs)
            ranked = sorted(zip(documents, scores), key=lambda x: x[1], reverse=True)
            top = [doc for doc, _ in ranked[:RERANK_TOP_K]]
            logger.info(f"Re-ranked {len(documents)} → kept top {len(top)}")
            return top

        return await asyncio.to_thread(_score)


reranker_service = RerankerService()