"""Приём аватарок: проверка содержимого и хранение.

Тип определяется по первым байтам, а не по имени файла и не по
content-type — и то и другое приходит от клиента и подделывается
одной строкой в curl.
"""

from __future__ import annotations

import pytest

from app.services.avatars import AvatarError, MAX_BYTES, detect_extension, remove, save, validate

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32
JPG = b"\xff\xd8\xff\xe0" + b"0" * 32
GIF = b"GIF89a" + b"0" * 32
WEBP = b"RIFF" + b"0000" + b"WEBP" + b"0" * 32


class TestDetect:
    @pytest.mark.parametrize(
        "data,expected",
        [(PNG, "png"), (JPG, "jpg"), (GIF, "gif"), (WEBP, "webp")],
    )
    def test_uznaet_format_po_soderzhimomu(self, data, expected):
        assert detect_extension(data) == expected

    def test_ne_kartinku_ne_prinimaet(self):
        with pytest.raises(AvatarError):
            detect_extension(b"<?php system($_GET['x']); ?>")

    def test_rasshirenie_v_imeni_ne_spasaet(self):
        # Классическая подмена: файл назвали avatar.png, а внутри скрипт
        with pytest.raises(AvatarError):
            validate(b"#!/bin/sh\nrm -rf /")


class TestValidate:
    def test_pustoy_fayl(self):
        with pytest.raises(AvatarError):
            validate(b"")

    def test_slishkom_bolshoy(self):
        big = PNG + b"0" * MAX_BYTES
        with pytest.raises(AvatarError):
            validate(big)

    def test_normalnyy_prohodit(self):
        assert validate(PNG) == "png"


class TestSave:
    def test_imya_fayla_iz_id_a_ne_iz_prislannogo(self, tmp_path):
        path = save(tmp_path, 42, PNG)
        assert path == "/static/avatars/42.png"
        assert (tmp_path / "42.png").is_file()

    def test_smena_formata_ne_ostavlyaet_musora(self, tmp_path):
        save(tmp_path, 7, PNG)
        save(tmp_path, 7, JPG)

        # Прежний файл должен исчезнуть, иначе на диске копится мусор,
        # на который никто не ссылается
        assert not (tmp_path / "7.png").exists()
        assert (tmp_path / "7.jpg").is_file()

    def test_udalenie(self, tmp_path):
        save(tmp_path, 9, WEBP)
        remove(tmp_path, 9)
        assert list(tmp_path.iterdir()) == []

    def test_udalenie_nesushchestvuyushchey_ne_padaet(self, tmp_path):
        remove(tmp_path, 123)

    def test_chuzhie_fayly_ne_trogaem(self, tmp_path):
        (tmp_path / "keep.png").write_bytes(PNG)
        save(tmp_path, 1, PNG)
        remove(tmp_path, 1)

        assert (tmp_path / "keep.png").is_file()
