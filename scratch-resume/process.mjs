import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const SRC = '/root/.claude/uploads/570eaecd-1355-5b01-8443-1f68727cb0d8';
const OUT = './images';
fs.mkdirSync(OUT, {recursive:true});

// map filename -> semantic key
const map = {
  '028dc9b7-1001377930.jpg': 'note1',      // handwritten
  '4b52f7df-1001377931.jpg': 'note2',      // handwritten
  'e11a6e93-1001377932.jpg': 'wedding_car',
  '02eff640-1001377934.jpg': 'portrait_white_turban',
  '139e8af6-1001377933.jpg': 'portrait_red',
  'f27c2d6a-1001377929.jpg': 'group_office',
  '00ab23e4-1001377928.jpg': 'letter_official',
  '2b52f39e-1001377927.jpg': 'award_stage_shawl',
  'bda82600-1001377926.jpg': 'news_clip',
  '129b6751-1001377925.jpg': 'dignitaries',
  'f1706d62-1001377924.jpg': 'delhi_award',
  '43e9522c-1001377923.jpg': 'concert_child',
  'ab884853-1001377922.jpg': 'concert_gift',
  '4e404069-1001377919.jpg': 'concert_stage',
  '5ab55b85-1001377918.jpg': 'lamp_lighting',
  '7425cff8-1001377917.jpg': 'felicitation_orange',
  'a6d3b442-1001377916.jpg': 'felicitation_red',
  '38b3b2f5-1001377915.jpg': 'felicitation_village',
  'fdbbd4be-1001377912.jpg': 'felicitation_temple',
  'ffdffcf4-1001377911.jpg': 'children_outing',
};

const meta = {};
for (const [file, key] of Object.entries(map)) {
  const src = path.join(SRC, file);
  if (!fs.existsSync(src)) { console.log('MISSING', file); continue; }
  const img = sharp(src).rotate(); // auto-orient
  const m = await img.metadata();
  // resize: max 1400px long edge, quality jpeg
  const out = path.join(OUT, key + '.jpg');
  await sharp(src).rotate().resize({width:1400, height:1400, fit:'inside', withoutEnlargement:true})
    .jpeg({quality:82, mozjpeg:true}).toFile(out);
  const om = await sharp(out).metadata();
  meta[key] = {w: om.width, h: om.height, orient: om.width>=om.height?'land':'port'};
  console.log(key.padEnd(24), `${om.width}x${om.height}`, meta[key].orient);
}
fs.writeFileSync('img-meta.json', JSON.stringify(meta,null,2));
console.log('done');
