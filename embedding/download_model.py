from sentence_transformers import SentenceTransformer

MODEL_NAME = "BAAI/bge-small-zh-v1.5"

if __name__ == "__main__":
    SentenceTransformer(MODEL_NAME)
    print(f"Model ready: {MODEL_NAME}")
