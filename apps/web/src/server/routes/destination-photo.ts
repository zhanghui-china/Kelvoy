import sharp from 'sharp';
/** Only allow photo formats, then force bounded CPU decoding before persistence. */
export async function destinationPhotoExtension(bytes: Uint8Array): Promise<'png' | 'jpg' | 'webp' | null> {
    const buffer = Buffer.from(bytes);
    let expected: 'png' | 'jpeg' | 'webp';
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        expected = 'png';
    }
    else if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) {
        expected = 'jpeg';
    }
    else if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
        expected = 'webp';
    }
    else {
        return null;
    }
    try {
        const image = sharp(buffer, { failOn: 'warning', limitInputPixels: 100000000 }).timeout({ seconds: 10 });
        const metadata = await image.metadata();
        if (metadata.format !== expected || (metadata.pages ?? 1) !== 1)
            return null;
        // metadata() alone only parses headers; stats() actually decodes every pixel.
        await image.stats();
        return expected === 'jpeg' ? 'jpg' : expected;
    }
    catch {
        return null;
    }
}
