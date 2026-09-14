import os


def get_database_url() -> str:
    return os.getenv(
        "DATABASE_URL",
        "postgresql://rag_user:rag_password@localhost:5432/contract_rag",
    )
