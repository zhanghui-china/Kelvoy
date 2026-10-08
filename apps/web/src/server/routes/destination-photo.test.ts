import { test, expect } from 'bun:test';
import sharp from 'sharp';
import { destinationPhotoExtension } from './destination-photo';
test('fully decodes supported photo formats', async () => {
    for (const format of ['png', 'jpeg', 'webp'] as const) {
        const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fafafa' } }).toFormat(format).toBuffer();
        expect(await destinationPhotoExtension(image)).toBe(format === 'jpeg' ? 'jpg' : format);
    }
});
test('rejects signature-valid PNG with corrupt pixel data', async () => {
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fafafa' } }).png().toBuffer();
    let offset = 8;
    while (offset + 12 <= image.length) {
        const length = image.readUInt32BE(offset);
        if (image.toString('ascii', offset + 4, offset + 8) === 'IDAT')
            image.fill(0, offset + 8, offset + 8 + length);
        offset += length + 12;
    }
    expect(await destinationPhotoExtension(image)).toBeNull();
});
