# Prepare Veil for a conversation

Open **Prep** on the overlay, or **Knowledge** in the dashboard.

## Before starting Listen

1. In **Prepare**, add your background and preferred answer style under **About you**.
2. Add the conversation name, objective, audience, and relevant facts under **Session brief**.
3. Click **Save background**. The two include switches are saved with this form.
4. Leave **Use personal knowledge** on, then start Listen.

The brief persists until you change or clear it. Each Listen session saves a copy at its start, so edits apply to the next session. Ask uses the latest saved version. The main knowledge switch excludes saved preparation and references from subsequent answers, including during an active call; it cannot retract an answer already sent to a provider.

## References

Use **Library** for project notes, resume text, meeting context, or other material. Import TXT, Markdown, CSV, or JSON up to 2 MB; paste relevant text from PDFs. Sources can be searched, edited, excluded without deleting them, or deleted with an inline confirmation.

Pin up to three references to always supply their opening excerpt (up to 700 characters). Keep the most important facts at the top. An excluded pinned source is not supplied, but still occupies a pin slot. Other sources are retrieved by relevance. Focus tags prefer matching sources; they do not prohibit other relevant sources.

Saving and Listen retrieval use local search. If OpenAI is configured, the optional semantic-indexing checkbox sends a saved source to OpenAI for embeddings. Ask uses embeddings for sources with an existing semantic index, falling back to local matches if the embedding request fails or exceeds its short timeout. Editing without the checkbox rebuilds that source as local search only.

## Check and review

**Check context** previews saved background, pins, and local keyword matches without an AI request. It shows saved changes only. Ask's optional semantic search may select different references.

In **Meetings**, open a Listen session and expand **Background at session start**. The snapshot is included in Markdown exports and in the notes of a saved meeting copy. Regenerated cards use that session's starting preparation. Library references remain editable; this is not a snapshot of every reference sent for every answer. Sessions recorded before this feature have no saved preparation.

## Evidence and privacy

Background is user-provided evidence. Veil is instructed to cite personal claims with `[P:profile]`, `[P:brief]`, or `[K:source-chunk]`, disclose material conflicts or unavailable retrieval, and avoid inventing experience. These instructions are not a guarantee of model correctness.

Sources and preparation are stored locally in SQLite. Included context is sent to the configured answer provider for an active request. The optional profile interview also calls the answer provider; its saved notes use local indexing. Preparation is not automatically rewritten from conversation transcripts. Deleting or pruning a Listen session removes its starting snapshot; saved profile information and separately saved meeting copies remain until edited or deleted.

## Verification

Automated coverage exercises bounded context, independent include switches, profile availability without a keyword match, frozen/empty snapshots, knowledge-off behavior during retrieval, partial retrieval failures, source selection, source exclusion, migration preservation, session deletion with foreign keys both on and off, and atomic source replacement preserving pin/include flags. Live-call answer quality still requires use with the chosen model and microphone setup.
