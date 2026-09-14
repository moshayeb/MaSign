from dataclasses import dataclass
from io import BytesIO
from zipfile import BadZipFile, ZipFile

from fastapi import HTTPException, UploadFile, status


MAX_UPLOAD_BYTES = 10 * 1024 * 1024

SUPPORTED_EXTENSIONS = {
    ".txt": "txt",
    ".pdf": "pdf",
    ".docx": "docx",
}

SUPPORTED_MIME_TYPES = {
    "text/plain": "txt",
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
}

GENERIC_MIME_TYPES = {"application/octet-stream"}


@dataclass(frozen=True)
class ValidatedUpload:
    filename: str
    file_type: str
    content_type: str | None
    size_bytes: int
    content: bytes


async def validate_contract_upload(upload: UploadFile) -> ValidatedUpload:
    content = await upload.read(MAX_UPLOAD_BYTES + 1)
    size_bytes = len(content)

    if size_bytes == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )

    if size_bytes > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Uploaded file must be {MAX_UPLOAD_BYTES} bytes or smaller.",
        )

    detected_type = detect_supported_file_type(content)
    if detected_type is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Unsupported file content. Upload a TXT, PDF, or DOCX contract.",
        )

    claimed_extension_type = supported_extension_type(upload.filename)
    if has_extension(upload.filename) and claimed_extension_type is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Unsupported filename extension. Upload a TXT, PDF, or DOCX contract.",
        )

    if claimed_extension_type is not None and claimed_extension_type != detected_type:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Filename extension does not match uploaded file content.",
        )

    claimed_mime_type = supported_mime_type(upload.content_type)
    if has_non_generic_mime_type(upload.content_type) and claimed_mime_type is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Unsupported client MIME type. Upload a TXT, PDF, or DOCX contract.",
        )

    if claimed_mime_type is not None and claimed_mime_type != detected_type:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Client MIME type does not match uploaded file content.",
        )

    return ValidatedUpload(
        filename=upload.filename or "uploaded-contract",
        file_type=detected_type,
        content_type=upload.content_type,
        size_bytes=size_bytes,
        content=content,
    )


def detect_supported_file_type(content: bytes) -> str | None:
    if content.startswith(b"%PDF-"):
        return "pdf"

    if is_docx(content):
        return "docx"

    if is_text(content):
        return "txt"

    return None


def supported_extension_type(filename: str | None) -> str | None:
    if not has_extension(filename):
        return None

    assert filename is not None
    extension = f".{filename.rsplit('.', maxsplit=1)[-1].lower()}"
    return SUPPORTED_EXTENSIONS.get(extension)


def has_extension(filename: str | None) -> bool:
    return bool(filename and "." in filename.rsplit("/", maxsplit=1)[-1])


def supported_mime_type(content_type: str | None) -> str | None:
    if not content_type:
        return None

    media_type = content_type.split(";", maxsplit=1)[0].strip().lower()
    return SUPPORTED_MIME_TYPES.get(media_type)


def has_non_generic_mime_type(content_type: str | None) -> bool:
    if not content_type:
        return False

    media_type = content_type.split(";", maxsplit=1)[0].strip().lower()
    return media_type not in GENERIC_MIME_TYPES


def is_docx(content: bytes) -> bool:
    try:
        with ZipFile(BytesIO(content)) as archive:
            names = set(archive.namelist())
    except BadZipFile:
        return False

    return "[Content_Types].xml" in names and "word/document.xml" in names


def is_text(content: bytes) -> bool:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return False

    if not text.strip():
        return False

    control_chars = sum(
        1
        for character in text
        if ord(character) < 32 and character not in "\n\r\t\f\b"
    )
    return control_chars / len(text) < 0.05
