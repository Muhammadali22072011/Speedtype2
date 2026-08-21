"""Аватарки: приём файла, проверка и хранение.

Хранение на диске, а не в базе: картинка это статика, и раздавать её
должен тот же механизм, что языки и темы, а не запрос к SQLite на каждую
загрузку страницы.

Pillow в зависимостях нет и добавлять его ради одной функции не стоит,
поэтому тип файла определяем по сигнатуре первых байт. Расширению
в имени и заголовку content-type верить нельзя: и то и другое приходит
от клиента и подделывается тривиально.
"""

from __future__ import annotations

from pathlib import Path

#: Больше двух мегабайт для аватарки не нужно, а вот забить диск —
#: вполне достаточно
MAX_BYTES = 2 * 1024 * 1024

#: Сигнатура начала файла → расширение, под которым мы его сохраним
_SIGNATURES: list[tuple[bytes, str]] = [
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"\xff\xd8\xff", "jpg"),
    (b"GIF87a", "gif"),
    (b"GIF89a", "gif"),
]


class AvatarError(ValueError):
    """Файл не подошёл. Текст показывается человеку как есть."""


def detect_extension(data: bytes) -> str:
    """Расширение по содержимому файла.

    webp опознаётся отдельно: у него составная сигнатура — RIFF в начале
    и WEBP с четвёртого байта.
    """
    for signature, extension in _SIGNATURES:
        if data.startswith(signature):
            return extension

    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"

    raise AvatarError("Это не картинка. Подойдут png, jpg, gif или webp")


def validate(data: bytes) -> str:
    """Проверить файл и вернуть расширение, под которым его сохранить."""
    if not data:
        raise AvatarError("Файл пустой")

    if len(data) > MAX_BYTES:
        raise AvatarError(f"Файл больше {MAX_BYTES // (1024 * 1024)} МБ")

    return detect_extension(data)


def save(directory: Path, user_id: int, data: bytes) -> str:
    """Сохранить аватарку и вернуть путь для клиента.

    Имя файла собирается из id пользователя, а не из присланного имени:
    иначе через ``../`` можно записать что угодно куда угодно.

    Прежние файлы того же человека удаляем — иначе после пары смен
    формата на диске осталась бы стопка мусора, на который никто
    не ссылается.
    """
    extension = validate(data)
    directory.mkdir(parents=True, exist_ok=True)

    remove(directory, user_id)

    path = directory / f"{user_id}.{extension}"
    path.write_bytes(data)

    return f"/static/avatars/{path.name}"


def remove(directory: Path, user_id: int) -> None:
    """Удалить аватарку пользователя в любом из форматов."""
    for extension in {"png", "jpg", "gif", "webp"}:
        candidate = directory / f"{user_id}.{extension}"
        if candidate.is_file():
            candidate.unlink()
