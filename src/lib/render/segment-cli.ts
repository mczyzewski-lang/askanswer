// Child-process entry: renders one frame range of a composition (see renderComposition).
import fs from "node:fs";
import { renderVideoSegment, type SegmentJob } from "./server-render";

const job = JSON.parse(fs.readFileSync(process.argv[2], "utf8")) as SegmentJob;
renderVideoSegment(job, (n) => {
  process.stdout.write(`progress ${n}\n`);
})
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
