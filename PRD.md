# Session Inspector

We're building an Agentic Session Inspector that will be deployed on sessioninspector.ai

Features

* Simple landing screen where you drag and drop a session to import and view everything about it
* Top level stats for everything about the session (name, start time, duration, tokens used, etc)
* Timeline of everything that happened in the session: sortable by chronological, token usage, or duration
* Right side openable treemap style visualization of durations of steps or token usage of steps (if in those modes)
* Detailed view of each step that takes the whole scren and shows things like message content/metadata, or tool call args/results, errors

Design

* Use the images in design-language inspiration for various parts of the system. We're going for a swiss typography inspired design
  and there are specific images with labels that will be useful references for each thing
* Use the frontend-design skill to make sure everything is minimal and very polished/elevated
* Use the algorithmic-art skill if there is a place that really makes sense to apply it
* There should be an impressive full screen animation in the background when on the screen where you drag and drop a file. Inspired
  again by the swiss design language from the inspiration folder

Flows

* The single core user flow will be to drag in a Claude Code or goose session `.json(l)` and then see it visualized
  we'll parse the whole thing in the browser and render eveyrthing as fast as possible
* We should include two files as demos with a small label on the bottom right and the user should be able to test it
  by dragging these to the same box that accepts the files dragged in from outside
