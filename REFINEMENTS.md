# Landing View

* Replace the “Drop in a session to see where the time and tokens went, then open any step” message with one that says “Drop in a session file from your coding agent to get a detailed view of where the time and tokens went”

# Top Level Session View

* In the top bar, the “Conversation” and “Charged” entries are confusing from a UX perspective
    * Reframe it so the Conversation entry is a single representation of the size of the entire conversation in tokens
    * And reframe “Charged” so that it’s a clear measurement of the number of tokens consumed by sending the conversation as many times as needed. Take into account prompt caching if stats about it are in the underlying data, but don’t guess if it is not
* Change the “TOKENS CONTRIBUTED” label on the treemap to “TOKENS BY STEP” to match the duration one
* Make errors much more visually prominent, both in the top level listing and once you navigate into a step’s detail view
    * Make it so the whole bar in the step listing has a red background (an then appropriately adjusted white colors - white etc) so they stick out as obvious

# Detail View

* Inside the detail view a lot of the info is pulling from the wrong places in the raw data
* First look at the Step data model. Right now it has a “kind” but I think the more natural thing to use in the underlying data would be “type” - confirm and make this change
* Right now for example it’s rendering automode steps where it’s looking inside “attachment”, pulling out type from that, and saying that’s the top level step and rendering that as a step. This should be more a property of the session I think and rendered in the top bar? Something like Skill Listing is different because that’s something that happened it should be accounted for the same as tool calls etc. Those are the kinds of things that belong in the list.
* We have “contributed” “added to context” “generated” and “charged on this request” fields on the left but parts of those concepts are conceptually overlapping
* We should have one measurement of tokens contributed just labeled “tokens” as we’re trying to view only what this step contributed
* Share of Session says 0.0% for Skill Listing events for example, but it reports as the second highest token consuming step so something is broken with measuring the % here
