import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultConfig } from "../src/config.js";
import { createCore } from "../src/compress.js";
import { prune } from "../src/prune.js";
import { assignRefs } from "../src/refs.js";
import { createInitialState } from "../src/state.js";
import { coreToGoogle, googleToCore } from "../src/wire/google.js";
import { VALIDATORS } from "../../tests/wire-contract-fakes.ts";

const model = "gemini-4-neon";

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
    const rendered = coreToGoogle(prune(messages, folded), { model });
    assert.deepEqual(VALIDATORS.google({ contents: rendered }, model), []);
    const toolContents = rendered.flatMap(({ role, parts }) => {
      const toolParts = parts.filter(
        (part) => part.functionCall || part.functionResponse,
      );
      return toolParts.length ? [{ role, parts: toolParts }] : [];
    });
    assert.deepEqual(toolContents, protectedTool ? batch : []);
  });
}

test("rebuilding an already-split Google fold repairs only the unsigned leading call", () => {
  const reasoning = {
    text: "Check the fixture before running it",
    thought: true,
    thoughtSignature: "original-reasoning",
  };
  const callHead = {
    functionCall: { name: "read_file", args: {} },
    thoughtSignature: "original-head",
  };
  const unsigned = {
    functionCall: { name: "run_command", args: { command: "fixture" } },
  };
  const sibling = { functionCall: { name: "helper", args: {} } };
  const signedSibling = {
    functionCall: { name: "report", args: {} },
    thoughtSignature: "original-sibling",
  };
  const later = {
    functionCall: { name: "verify", args: {} },
    thoughtSignature: "original-later",
  };
  const reply = (name: string) => ({
    functionResponse: { name, response: { ok: true } },
  });
  const { msgs: messages } = googleToCore({
    contents: [
      { role: "user", parts: [{ text: "Run the fixture" }] },
      {
        role: "model",
        parts: [reasoning, callHead, unsigned, sibling, signedSibling],
      },
      {
        role: "user",
        parts: [
          reply("read_file"),
          reply("run_command"),
          reply("helper"),
          reply("report"),
        ],
      },
      { role: "model", parts: [later] },
      { role: "user", parts: [reply("verify")] },
    ],
  });
  const ids = messages
    .filter((m) => m.toolName === "read_file")
    .map((m) => m.id);
  const state = createInitialState();
  state.blocks = [
    {
      blockId: "b1",
      runId: "r1",
      tier: 1,
      summary: "Read the fixture",
      directMessageIds: ids,
      effectiveMessageIds: ids,
      directBlockIds: [],
      compressedTokens: 100,
      createdAt: 1,
      survivedCount: 0,
      generation: "young",
      active: true,
    },
  ];
  const retained = prune(messages, state);

  const rendered = coreToGoogle(retained, { model });

  assert.deepEqual(VALIDATORS.google({ contents: rendered }, model), []);
  assert.deepEqual(
    rendered
      .filter((content) => content.role === "model")
      .map(({ parts }) => parts),
    [
      [
        reasoning,
        { ...unsigned, thoughtSignature: "skip_thought_signature_validator" },
        sibling,
        signedSibling,
      ],
      [later],
    ],
  );
  assert.equal(Object.hasOwn(unsigned, "thoughtSignature"), false);
  for (const otherModel of ["gemini-2.5-pro", "claude-sonnet"]) {
    const unchanged = coreToGoogle(retained, { model: otherModel });
    assert.deepEqual(
      unchanged.find((content) => content.role === "model")?.parts,
      [reasoning, unsigned, sibling, signedSibling],
    );
  }
});

test("rebuilding a completed Google turn preserves unsigned call bytes", () => {
  const previous = [
    { role: "user", parts: [{ text: "Check the old fixture" }] },
    { role: "model", parts: [{ functionCall: { name: "check", args: {} } }] },
    {
      role: "user",
      parts: [{ functionResponse: { name: "check", response: { ok: true } } }],
    },
    { role: "model", parts: [{ text: "Checked" }] },
  ];
  const { msgs } = googleToCore({
    contents: [...previous, { role: "user", parts: [{ text: "Next task" }] }],
  });

  const rendered = coreToGoogle(msgs, { model });

  assert.deepEqual(VALIDATORS.google({ contents: rendered }, model), []);
  assert.equal(
    JSON.stringify(rendered.slice(0, previous.length)),
    JSON.stringify(previous),
  );
});
