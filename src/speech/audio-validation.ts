/** Validate the PCM WAV container before passing worker output to FFmpeg. */
export function isPcmWave(audio: Buffer): boolean {
  if (
    audio.length < 44 ||
    audio.toString('ascii', 0, 4) !== 'RIFF' ||
    audio.toString('ascii', 8, 12) !== 'WAVE' ||
    audio.readUInt32LE(4) + 8 !== audio.length
  )
    return false;
  let format = false;
  let data = false;
  let alignment = 0;
  for (let offset = 12; offset + 8 <= audio.length; ) {
    const size = audio.readUInt32LE(offset + 4);
    const end = offset + 8 + size;
    if (end > audio.length) return false;
    const id = audio.toString('ascii', offset, offset + 4);
    if (id === 'fmt ') {
      if (size < 16) return false;
      const channels = audio.readUInt16LE(offset + 10);
      const rate = audio.readUInt32LE(offset + 12);
      alignment = audio.readUInt16LE(offset + 20);
      format =
        audio.readUInt16LE(offset + 8) === 1 &&
        channels >= 1 &&
        channels <= 2 &&
        rate > 0 &&
        audio.readUInt16LE(offset + 22) === 16 &&
        alignment === channels * 2;
    }
    if (id === 'data') data = format && size > 0 && size % alignment === 0;
    offset = end + (size % 2);
  }
  return format && data;
}

/** Require complete Ogg pages, an Opus identification packet and end-of-stream. */
export function isOggOpus(audio: Buffer): boolean {
  let offset = 0;
  let pages = 0;
  let ended = false;
  while (offset < audio.length) {
    if (
      ended ||
      offset + 27 > audio.length ||
      audio.toString('ascii', offset, offset + 4) !== 'OggS' ||
      audio[offset + 4] !== 0
    )
      return false;
    const segments = audio[offset + 26];
    const start = offset + 27 + segments;
    if (start > audio.length) return false;
    let size = 0;
    for (let i = offset + 27; i < start; i++) size += audio[i];
    const end = start + size;
    if (end > audio.length) return false;
    if (
      pages === 0 &&
      (!(audio[offset + 5] & 2) ||
        size < 19 ||
        audio.toString('ascii', start, start + 8) !== 'OpusHead')
    )
      return false;
    ended = Boolean(audio[offset + 5] & 4) && audio.readBigUInt64LE(offset + 6) > 0n;
    pages++;
    offset = end;
  }
  return pages >= 2 && ended;
}
