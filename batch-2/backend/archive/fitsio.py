"""A small FITS reader in plain Python and numpy (no compiled astronomy library)."""
import math
import re

import numpy as np

BLOCK = 2880
IMAGE_TYPES = {8: ">u1", 16: ">i2", 32: ">i4", 64: ">i8", -32: ">f4", -64: ">f8"}
COLUMN_TYPES = {"L": "u1", "B": "u1", "I": ">i2", "J": ">i4", "K": ">i8",
                "A": "S1", "E": ">f4", "D": ">f8"}


def _value(text):
    text = text.strip()
    if text.startswith("'"):
        out, i = [], 1
        while i < len(text):
            if text[i] == "'":
                if text[i + 1:i + 2] == "'":
                    out.append("'")
                    i += 2
                    continue
                break
            out.append(text[i])
            i += 1
        return "".join(out).rstrip()
    text = text.split("/", 1)[0].strip()
    if text in ("T", "F"):
        return text == "T"
    try:
        return int(text)
    except ValueError:
        try:
            return float(text.replace("D", "E"))
        except ValueError:
            return text


def _header(raw, offset):
    header = {}
    while True:
        block = raw[offset:offset + BLOCK]
        if len(block) < BLOCK:
            raise ValueError("file ends inside a header")
        offset += BLOCK
        for i in range(0, BLOCK, 80):
            card = block[i:i + 80].decode("ascii", "replace")
            if card.startswith("END "):
                return header, offset
            if card.startswith("HIERARCH") and "=" in card:
                key, value = card[8:].split("=", 1)
                header[key.strip()] = _value(value)
            elif card[8:10] == "= ":
                header[card[:8].strip()] = _value(card[10:])


class Hdu:
    def __init__(self, raw, header, start):
        self.raw, self.header, self.start = raw, header, start
        self.name = str(header.get("EXTNAME", "PRIMARY")).strip()
        naxis = int(header.get("NAXIS", 0))
        self.shape = [int(header.get(f"NAXIS{i}", 0)) for i in range(1, naxis + 1)]
        self.bitpix = int(header.get("BITPIX", 8))
        count = math.prod(self.shape) if naxis else 0
        self.size = ((count + int(header.get("PCOUNT", 0)))
                     * int(header.get("GCOUNT", 1)) * abs(self.bitpix) // 8)

    def image(self):
        if str(self.header.get("XTENSION", "IMAGE")).strip() != "IMAGE":
            raise ValueError(f"{self.name} is not an image")
        data = np.frombuffer(self.raw, IMAGE_TYPES[self.bitpix],
                             math.prod(self.shape), self.start).reshape(self.shape[::-1])
        data = data.astype(data.dtype.newbyteorder("="))
        scale, zero = self.header.get("BSCALE", 1), self.header.get("BZERO", 0)
        if scale != 1 or zero != 0:
            data = data * scale + zero
        return data

    def table(self):
        columns, offset = {}, self.start
        for n in range(1, int(self.header["TFIELDS"]) + 1):
            match = re.match(r"(\d*)([A-Z])", str(self.header[f"TFORM{n}"]).strip())
            repeat, code = int(match.group(1) or 1), match.group(2)
            if code not in COLUMN_TYPES:
                raise ValueError(f"unsupported table column type {code}")
            data = np.frombuffer(self.raw, COLUMN_TYPES[code], repeat, offset)
            offset += data.nbytes
            dims = re.findall(r"\d+", str(self.header.get(f"TDIM{n}", "")))
            if dims:
                data = data.reshape([int(d) for d in dims][::-1])
            columns[str(self.header.get(f"TTYPE{n}", n)).strip()] = data.astype(
                data.dtype.newbyteorder("=")) if code != "A" else data
        return columns


def spans(raw):
    """Byte range (start, end) of every layer, by name."""
    out, offset = {}, 0
    while offset < len(raw):
        header, start = _header(raw, offset)
        hdu = Hdu(raw, header, start)
        end = start + -(-hdu.size // BLOCK) * BLOCK
        out.setdefault(hdu.name, (offset, end))
        offset = end
    return out


def read(raw):
    hdus, offset = {}, 0
    while offset < len(raw):
        header, start = _header(raw, offset)
        hdu = Hdu(raw, header, start)
        if start + hdu.size > len(raw):
            raise ValueError("file ends inside its data")
        hdus.setdefault(hdu.name, hdu)
        offset = start + -(-hdu.size // BLOCK) * BLOCK
    return hdus


def _card(key, value):
    if isinstance(value, bool):
        text = f"{key:<8s}= {'T' if value else 'F':>20s}"
    elif isinstance(value, int):
        text = f"{key:<8s}= {value:>20d}"
    elif isinstance(value, float):
        text = f"{key:<8s}= {value:>20.12G}"
    else:
        text = f"{key:<8s}= '{str(value).replace(chr(39), chr(39) * 2):<8s}'"
    return text[:80].ljust(80)


def _block(cards):
    text = "".join(_card(k, v) for k, v in cards) + "END".ljust(80)
    return (text + " " * (-len(text) % BLOCK)).encode("ascii", "replace")


def write(layers):
    """layers: list of (2-D float32 array, [(keyword, value), ...]). Returns FITS bytes."""
    out = [_block([("SIMPLE", True), ("BITPIX", 8), ("NAXIS", 0), ("EXTEND", True)])]
    for data, cards in layers:
        data = np.ascontiguousarray(data, ">f4")
        head = [("XTENSION", "IMAGE"), ("BITPIX", -32), ("NAXIS", 2),
                ("NAXIS1", data.shape[1]), ("NAXIS2", data.shape[0]),
                ("PCOUNT", 0), ("GCOUNT", 1)] + list(cards)
        raw = data.tobytes()
        out += [_block(head), raw + b"\0" * (-len(raw) % BLOCK)]
    return b"".join(out)
