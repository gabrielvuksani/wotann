/**
 * Manual verification: feed a synthetic OSC 133 stream and confirm 3 blocks
 * emerge. This is a one-off test — part of the Phase D verification checklist.
 */
import { describe, it, expect } from "vitest";
import { Osc133Parser, OSC_133 } from "../../../src/ui/terminal-blocks/osc-133-parser.js";
import { BlockBuffer } from "../../../src/ui/terminal-blocks/block.js";

describe("Manual OSC 133 verification (3-block stream)", () => {
  it("emits 3 complete blocks from a representative stream", () => {
    const parser = new Osc133Parser();
    let id = 0;
    const buffer = new BlockBuffer({
      now: () => 100,
      nextId: () => { id += 1; return `blk-${id}`; },
    });
    const blocks: string[] = [];

    const streams = [
      `${OSC_133.PROMPT_BEGIN}user@wotann ~ $ ${OSC_133.COMMAND_BEGIN}ls${OSC_133.OUTPUT_BEGIN}README.md\npackage.json\n${OSC_133.outputEnd(0)}`,
      `${OSC_133.PROMPT_BEGIN}user@wotann ~ $ ${OSC_133.COMMAND_BEGIN}false${OSC_133.OUTPUT_BEGIN}${OSC_133.outputEnd(1)}`,
      `${OSC_133.PROMPT_BEGIN}user@wotann ~ $ ${OSC_133.COMMAND_BEGIN}echo done${OSC_133.OUTPUT_BEGIN}done\n${OSC_133.outputEnd(0)}`,
    ];

    for (const chunk of streams) {
      for (const ev of parser.feed(chunk)) {
        const b = buffer.consume(ev);
        if (b) blocks.push(`${b.id} cmd=${b.commandText} exit=${b.exitCode}`);
      }
    }

    console.log("Blocks:\n" + blocks.join("\n"));
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toContain("cmd=ls");
    expect(blocks[0]).toContain("exit=0");
    expect(blocks[1]).toContain("cmd=false");
    expect(blocks[1]).toContain("exit=1");
    expect(blocks[2]).toContain("cmd=echo done");
    expect(blocks[2]).toContain("exit=0");
  });
});
