# 108. A cluster is a name an organization puts on some of its languages, made while adding them, and never a level

Date: 2026-10-14 · By: Caleb Koster · Status: accepted

Reason: Spoken made a "Spoken Worldwide" organization, then had to make a
second organization, "Dar Khamsa Cluster", for the five languages of one
cluster, because nothing grouped languages. They want everything under the
one organization, and to be asked while setting up whether it is one
language or a cluster, so they can start work on one language or several.
Caleb asked for clusters as tagging and organizing, made when needed, that
do not reorganize the organization and language streams (2026-10-14). So a
cluster is two organization-stream registers (`core/org.ts`):
`v1.ClusterNamed { clusterId, name }`, its name, and
`v1.LanguageClusterSet { languageId, clusterId, inCluster }`, one per
(language, cluster). It is a tag: a language may be in several clusters or
none, two admins tagging offline both land, and a cluster no language is in
any more is gone (`orgClusters`). It is not the project level decision 34
took out, and not a scope (decision 63): no stream, no membership, no
settings and nothing on the server reads it; a phone pulls nothing more.
Grouping is the organization's to do: both events need Manage structure at
org scope, as adding a language does. Screens (demo ADR-045): New language
asks "What are you adding?" with One language picked; one language can
join a cluster, made right there; a cluster takes a name and its languages,
new ones and ones already here, and asks the usual steps once for the new
ones, each of which then owns its copy (decision 91). Manage lists clusters
above the languages in none; a cluster's page shows its languages and their
progress together, adds a new language or ones already here, renames and
ungroups it; a language's page names its clusters and More › Cluster
changes them; All languages on the Map tab filters by cluster. The Reports
dashboard on the web (decision 57) picks all languages, one cluster or
those in none, sums each cluster in Overview, and names a language's
clusters in its row, its page and the CSV; the device filters the rows the
server sent with its own fold of the organization, so the server still
knows nothing of clusters. Inviting stays per language: after a cluster,
the invite offers its new languages as chips. Not built: inviting to every
language of a cluster at once, and settings shared across a cluster.

Reverse if: organizations need a cluster to carry people or settings for
all its languages (an invite or a template for the cluster); then a cluster
gains its own recommendations as the organization has (decision 62), still
not a stream. Or if people put each language in one cluster only and
several clusters confuse them; then the picker becomes a single choice,
with no change to the events.

Amended (2026-10-20, Caleb Koster): Manage no longer lists a cluster as a
row among the languages. Caleb found it confusing that cards under the
"Languages" heading named clusters. With clusters, the organization's home
groups its languages under them instead: one card per cluster with a
heading in amber (its name, how many languages, a chevron that folds them
away and a ⋯ that opens the cluster's page), then "Not in a cluster" in
grey over the rest. A language in two clusters is under both. Groups start
open while the organization has 20 languages or fewer, closed past that,
and each keeps what it was toggled to across Back; a long group shows 20
rows at a time. With no clusters the list is one list, as before. Map and
Reports keep their cluster chips: they filter one list, so nothing there
reads as a language (`clusters/model.ts` `languageGroups`).

Amended (2026-11-02, Caleb Koster): grouping languages already here has a
row of its own on Manage, New cluster (LAN-140, decision 199). It opens New
language on the cluster's name and its languages, past the six steps, and
"Make the cluster" waits for a name and a language: a cluster still always
holds one.
