/**
 * Build app icons from public/Logo.png (icon mark on the left of the wordmark).
 * Outputs: src/app/favicon.ico, icon.png, apple-icon.png
 */
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pngToIco from 'png-to-ico';

const ROOT = join(import.meta.dirname, '..');
const LOGO = join(ROOT, 'public', 'Logo.png');
const APP_DIR = join(ROOT, 'src', 'app');

async function loadIconBuffer() {
  const meta = await sharp(LOGO).metadata();
  const height = meta.height ?? 268;
  const size = Math.min(height, meta.width ?? height);
  return sharp(LOGO)
    .extract({ left: 0, top: 0, width: size, height })
    .png()
    .toBuffer();
}

async function resizePng(sourceBuffer, size) {
  return sharp(sourceBuffer)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function main() {
  const source = await loadIconBuffer();

  const icon32 = await resizePng(source, 32);
  const icon16 = await resizePng(source, 16);
  const apple180 = await resizePng(source, 180);

  writeFileSync(join(APP_DIR, 'icon.png'), icon32);
  writeFileSync(join(APP_DIR, 'apple-icon.png'), apple180);

  const ico = await pngToIco([icon16, icon32]);
  writeFileSync(join(APP_DIR, 'favicon.ico'), ico);

  console.log('Wrote src/app/favicon.ico, icon.png, apple-icon.png');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
