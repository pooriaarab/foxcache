// NotebookLM, captured from tests/fixtures/notebooklm.json at https://notebook.google.com.
// The page tokens come from the fixture's app page at /, and every read is a
// batchexecute POST that the E2E answers by its rpcids and source-path.
export async function run({ fox, ask, check, ended }) {
  const tab = await fox.open("https://notebook.google.com/");
  await ask("capture:start", { provider: "notebooklm", fresh: true });
  const cp = await ended("notebooklm");
  check("NotebookLM capture is done", { status: "done", conversations: 1, projects: 2, errors: 0 }, { status: cp.status, conversations: cp.counts.conversations, projects: cp.counts.projects, errors: cp.counts.errors });
  const projects = await ask("archive:list", { kind: "projects", provider: "notebooklm" });
  check("the notebooks are projects with their sources' names", [["Recipes", []], ["Thesis sources", ["chapter1.pdf", "Field notes"]]], projects.map((p) => [p.name, p.files.map((f) => f.name)]).toSorted());
  const chat = await ask("archive:get", { kind: "conversations", key: "notebooklm:0a1b2c3d-1111-4222-8333-444455556666" });
  check("a notebook's chat reads oldest first, in its notebook", { projectId: "0a1b2c3d-1111-4222-8333-444455556666", texts: ["What does chapter 1 argue?", "Chapter 1 argues <script>alert(1)</script> is text."] }, { projectId: chat.projectId, texts: chat.messages.map((m) => m.text) });
  await tab.close();
}
