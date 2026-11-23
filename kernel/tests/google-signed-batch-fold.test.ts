import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultConfig } from "../src/config.js";
import { createCore } from "../src/compress.js";
import { assignRefs } from "../src/refs.js";
import { createInitialState } from "../src/state.js";
import { coreToGoogle, googleToCore } from "../src/wire/google.js";

for (const protectedTool of ["run_command", "read_file", undefined]) {
  test(`Google signed parallel calls fold atomically (protected: ${protectedTool ?? "none"})`, () => {
    const calls = [
      {
        functionCall: { name: "read_file", args: { target: "fixture" } },
        thoughtSignature: "signed-head",
      },
      { functionCall: { name: "run_command", args: { command: "fixture" } } },
    ];
    const responses = calls.map(({ functionCall }) => ({
      functionResponse: {
        name: functionCall.name,
        response: { output: "fixture ".repeat(80) },
      },
    }));
    const batch = [
      { role: "model", parts: calls },
      { role: "user", parts: responses },
    ];
    const { msgs: messages } = googleToCore({
      contents: [
        { role: "user", parts: [{ text: "older context ".repeat(80) }] },
        ...batch,
        { role: "user", parts: [{ text: "Latest user question" }] },
      ],
    });
    const state = createInitialState();
    state.messageRefs = assignRefs(messages, {
      existing: state.messageRefs,
      nextIndex: 1,
    }).map;
    const defaults = defaultConfig(150_000);
    const { state: folded, result } = createCore().applyCompression({
      messages,
      state,
      config: {
        ...defaults,
        preserveRecentMessages: 0,
        preserveRecentTokens: 0,
        protectedTools: protectedTool ? [protectedTool] : [],
        compress: {
          ...defaults.compress,
          minCompressRange: 1,
          minSummaryLength: 1,
        },
      },
      ranges: [
        { startRef: "m00001", endRef: "m00005", summary: "Older context" },
      ],
    });

    assert.deepEqual(result.errors, []);
    assert.equal(result.blocksCreated, 1);
    const covered = new Set(
      folded.blocks.flatMap((block) => block.effectiveMessageIds),
    );
    const rendered = coreToGoogle(
      messages.filter((message) => !covered.has(message.id)),
    );
    const toolContents = rendered.flatMap(({ role, parts }) => {
      const toolParts = parts.filter(
        (part) => part.functionCall || part.functionResponse,
      );
      return toolParts.length ? [{ role, parts: toolParts }] : [];
    });
    assert.deepEqual(toolContents, protectedTool ? batch : []);
  });
}
