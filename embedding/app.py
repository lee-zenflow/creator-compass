from functools import lru_cache
from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict, Field
from sentence_transformers import SentenceTransformer

MODEL_NAME = "BAAI/bge-small-zh-v1.5"
MODEL_VERSION = "1"
DIMENSIONS = 512
QUERY_INSTRUCTION = "为这个句子生成表示以用于检索相关文章："


class EmbedRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["document", "query"]
    texts: list[str] = Field(min_length=1, max_length=32)


class EmbedResponse(BaseModel):
    model: str
    version: str
    dimensions: Literal[512]
    vectors: list[list[float]]


@lru_cache(maxsize=1)
def get_model() -> SentenceTransformer:
    model = SentenceTransformer(MODEL_NAME)
    model.max_seq_length = 512
    return model


app = FastAPI(
    title="Creator Compass Local Embeddings",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.get("/health")
def health() -> dict[str, object]:
    return {"status": "ok", "model": MODEL_NAME, "dimensions": DIMENSIONS}


@app.post("/embed", response_model=EmbedResponse)
def embed(payload: EmbedRequest) -> EmbedResponse:
    texts = [text.strip() for text in payload.texts]
    if any(not text or len(text) > 12_000 for text in texts):
        raise ValueError("INVALID_INPUT")
    if payload.mode == "query":
        texts = [f"{QUERY_INSTRUCTION}{text}" for text in texts]
    vectors = get_model().encode(
        texts,
        normalize_embeddings=True,
        show_progress_bar=False,
        convert_to_numpy=True,
    )
    if vectors.shape != (len(texts), DIMENSIONS):
        raise RuntimeError("INVALID_MODEL_DIMENSIONS")
    return EmbedResponse(
        model=MODEL_NAME,
        version=MODEL_VERSION,
        dimensions=DIMENSIONS,
        vectors=vectors.tolist(),
    )
