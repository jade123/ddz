const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const ASSET_DIR = path.join(__dirname, "..", "public", "assets", "cards");
const SUITS = ["spades", "hearts", "diamonds", "clubs"];
const RANKS = [5, 6, 7, 8];

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodePng(file) {
  const png = fs.readFileSync(file);
  let offset = 8;
  let width;
  let height;
  let colorType;
  const idat = [];

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`Unsupported PNG color type ${colorType}: ${file}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  let cursor = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor++];
    const row = Buffer.from(raw.subarray(cursor, cursor + stride));
    cursor += stride;

    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = previous[x];
      const upperLeft = x >= channels ? previous[x - channels] : 0;
      if (filter === 1) row[x] = (row[x] + left) & 255;
      if (filter === 2) row[x] = (row[x] + up) & 255;
      if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 255;
      if (filter === 4) row[x] = (row[x] + paeth(left, up, upperLeft)) & 255;
    }

    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const target = (y * width + x) * 4;
      pixels[target] = row[source];
      pixels[target + 1] = row[source + 1];
      pixels[target + 2] = row[source + 2];
      pixels[target + 3] = channels === 4 ? row[source + 3] : 255;
    }
    previous = row;
  }

  return { width, height, pixels };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return output;
}

function encodePng(image) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 6;

  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    const row = y * (stride + 1);
    raw[row] = 0;
    image.pixels.copy(raw, row + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function pixel(image, x, y) {
  const index = (y * image.width + x) * 4;
  return image.pixels.subarray(index, index + 4);
}

function setPixel(image, x, y, color) {
  const index = (y * image.width + x) * 4;
  image.pixels[index] = color[0];
  image.pixels[index + 1] = color[1];
  image.pixels[index + 2] = color[2];
  image.pixels[index + 3] = color[3];
}

function isInk(color, red) {
  if (color[3] < 32) return false;
  if (red) return color[0] > 90 && color[0] > color[1] * 1.45;
  return color[0] < 115 && color[1] < 115 && color[2] < 115;
}

function extractPip(image, red) {
  const candidates = new Map();
  for (let y = 40; y <= 68; y += 1) {
    for (let x = 10; x <= 34; x += 1) {
      const color = pixel(image, x, y);
      if (isInk(color, red)) {
        candidates.set(`${x},${y}`, { x, y, color: Buffer.from(color) });
      }
    }
  }

  const components = [];
  while (candidates.size) {
    const seed = candidates.values().next().value;
    const points = [];
    const pending = [seed];
    candidates.delete(`${seed.x},${seed.y}`);
    while (pending.length) {
      const point = pending.pop();
      points.push(point);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const key = `${point.x + dx},${point.y + dy}`;
          const neighbor = candidates.get(key);
          if (neighbor) {
            candidates.delete(key);
            pending.push(neighbor);
          }
        }
      }
    }
    components.push(points);
  }
  const points = components.sort((a, b) => b.length - a.length)[0];
  const minX = Math.min(...points.map(point => point.x));
  const maxX = Math.max(...points.map(point => point.x));
  const minY = Math.min(...points.map(point => point.y));
  const maxY = Math.max(...points.map(point => point.y));
  return {
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    points: points.map(point => ({
      x: point.x - minX,
      y: point.y - minY,
      color: point.color
    }))
  };
}

function clearFace(image) {
  const background = Buffer.from(pixel(image, 56, 58));
  const corner = [];
  for (let y = 2; y <= 68; y += 1) {
    for (let x = 6; x <= 36; x += 1) {
      corner.push({ x, y, color: Buffer.from(pixel(image, x, y)) });
    }
  }

  for (let y = 64; y <= 191; y += 1) {
    for (let x = 10; x <= 104; x += 1) {
      setPixel(image, x, y, background);
    }
  }

  for (const point of corner) {
    setPixel(image, point.x, point.y, point.color);
    setPixel(
      image,
      image.width - 1 - point.x,
      image.height - 1 - point.y,
      point.color
    );
  }
}

function stamp(image, pip, centerX, centerY, upsideDown = false) {
  const left = Math.round(centerX - pip.width / 2);
  const top = Math.round(centerY - pip.height / 2);
  for (const point of pip.points) {
    const sourceX = upsideDown ? pip.width - 1 - point.x : point.x;
    const sourceY = upsideDown ? pip.height - 1 - point.y : point.y;
    setPixel(image, left + sourceX, top + sourceY, point.color);
  }
}

function layout(rank) {
  const pair = (y, upsideDown = false) => [
    [39, y, upsideDown],
    [69, y, upsideDown]
  ];
  if (rank === 5) {
    return [...pair(74), [55, 112, false], ...pair(150, true)];
  }
  if (rank === 6) {
    return [...pair(74), ...pair(112), ...pair(150, true)];
  }
  if (rank === 7) {
    return [
      ...pair(72),
      [55, 93, false],
      ...pair(116),
      ...pair(152, true)
    ];
  }
  return [
    ...pair(68),
    [55, 90, false],
    ...pair(112),
    [55, 134, true],
    ...pair(156, true)
  ];
}

for (const suit of SUITS) {
  const donor = decodePng(path.join(ASSET_DIR, `${suit}_9.png`));
  const pip = extractPip(donor, suit === "hearts" || suit === "diamonds");

  for (const rank of RANKS) {
    const file = path.join(ASSET_DIR, `${suit}_${rank}.png`);
    const image = decodePng(file);
    clearFace(image);
    for (const [x, y, upsideDown] of layout(rank)) {
      stamp(image, pip, x, y, upsideDown);
    }
    fs.writeFileSync(file, encodePng(image));
  }
}
