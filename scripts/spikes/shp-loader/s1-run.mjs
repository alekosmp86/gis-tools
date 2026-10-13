// SPIKE S1 runner.  node [--max-old-space-size=256] s1-run.mjs <file.shp> --strategy scan|a|b|c [--verify] [--csv out.csv] [--limit N] [--out ewkb.bin]
import fs from 'node:fs/promises';
import { processFile, MemMeter, HashSink, allocs, io } from './shp-lib.mjs';

const args = process.argv.slice(2);
const path = args[0];
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const strategy = opt('--strategy', 'scan');
const csv = opt('--csv', null);
const limit = Number(opt('--limit', Infinity));
const outFile = opt('--out', null);
const verify = args.includes('--verify');

const meter = new MemMeter(100);
const fh = outFile ? await fs.open(outFile, 'w') : null;
const sink = new HashSink(fh);
const t0 = Date.now();
const r = await processFile(path, { strategy, sink, verify, limit });
if (fh) await fh.close();
const mem = meter.stop();
const mb = (b) => (b / 1048576).toFixed(1) + ' MiB';
const f2 = (v) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

console.log(`file=${path}\nstrategy=${strategy} verify=${verify} node=${process.version} heapLimitFlag=${process.execArgv.join(' ') || '(none)'}`);
console.log(`wall=${((Date.now() - t0) / 1000).toFixed(1)}s  scan=${(r.T.scan / 1000).toFixed(1)}s assign=${(r.T.assign / 1000).toFixed(1)}s emit=${(r.T.emit / 1000).toFixed(1)}s`);
console.log(`peakRSS=${mb(mem.rss)} maxRSS(resourceUsage)=${mb(mem.maxRSS_bytes)} peakHeapUsed=${mb(mem.heapUsed)} peakHeapTotal=${mb(mem.heapTotal)} peakExternal=${mb(mem.external)} peakArrayBuffers=${mb(mem.arrayBuffers)} samples=${mem.samples}`);
console.log(`largestAlloc=${mb(allocs.max)} (${allocs.label})`);
console.log(`fileReads=${io.reads} bytesRead=${mb(io.bytes)}`);
const t = r.tot;
console.log(`records=${t.records} nulls=${t.nulls} otherShapeTypes=${t.otherTypes} emittedRows=${t.emitted} points=${t.points} rings=${t.rings}`);
console.log(`giant: rec=${r.giant.recno} points=${r.giant.points} rings=${r.giant.rings} shells=${r.giant.shells} holes=${r.giant.holes} net=${f2(r.giant.net)}`);
if (strategy !== 'b') {
  console.log(`shells=${t.shells} holes(area>=0)=${t.holes} zeroAreaRings=${t.zeroAreaRings} ringsLt4pts=${t.shortRings} nonClosed=${t.nonClosed}`);
  console.log(`netArea=${f2(t.netArea)} shellArea=${f2(t.shellArea)} holeArea=${f2(t.holeArea)}`);
  const top = [...r.rows].sort((a, b) => Math.abs(b.net) - Math.abs(a.net)).slice(0, 5);
  console.log('top5 by net area:');
  for (const x of top) console.log(`  rec ${x.recno} parts=${x.parts} points=${x.points} net=${f2(x.net)} shells=${x.shells} holes=${x.holes}`);
}
if (strategy === 'a') console.log('assignment:', JSON.stringify(r.assign));
console.log(`EWKB/out bytes=${r.outBytes} (${mb(r.outBytes)}) sha1=${strategy === 'scan' ? '-' : sink.digest()}`);
if (csv) {
  const lines = ['record,parts,points,net_area,shells,holes', ...r.rows.map((x) => `${x.recno},${x.parts},${x.points},${x.net.toFixed(4)},${x.shells},${x.holes}`)];
  await fs.writeFile(csv, lines.join('\n') + '\n');
  console.log('csv=' + csv);
}
