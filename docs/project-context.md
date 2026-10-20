# Idea: project context across conversations

Conversations cut across two axes: who is talking (a private session, a group chat) and what it is about (a project folder). When a chat drifts into a project's topic, a classifier could notice the topic segment and link it to that project. It does this automatically only when every chat member can already see the project; otherwise it suggests the link, and each author approves their own messages. The rule: moving content never widens its audience without consent.

Each project would keep a history index: topic chunks, extracted decisions, open questions and todos, and layered summaries up to a one-page overview. Every item links back to its sources, and the index uses full-text and vector search. The agent queries it through tools (`project_overview`, `history_search`, `history_open`) instead of loading it into memory. Permissions are checked at query time, so a conversation only gets results from sources all its members may see.

Deleting or unsharing a source must remove its chunks and regenerate the summaries built from it. A good first step is pull-only: a chat linked to several projects, whose agent can search their histories, with nothing moved.
