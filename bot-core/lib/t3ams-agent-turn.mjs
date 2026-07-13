// A generated-agent turn has two separately durable outbound effects: its
// textual reply and optional generated files.  The text is the primary answer
// and has its own chunk progress marker, while files remain independently
// retryable in the artifact outbox.  Drain the text first so a Bulletin/HOP
// upload or attachment statement failure cannot suppress the answer.
//
// Keep this tiny ordering boundary separate from the transport entry point so
// its retry semantics can be exercised without booting a BCTS client.
export const deliverAgentReplyBeforeArtifacts = async ({ deliverReply, deliverArtifacts } = {}) => {
  if (typeof deliverReply !== "function" || typeof deliverArtifacts !== "function") {
    throw new TypeError("deliverReply and deliverArtifacts must be functions");
  }
  await deliverReply();
  await deliverArtifacts();
};
