# 25. Templates instantiate with derived ids, and per-lane settings layer over project settings

Date: 2026-09-15 · By: Ryder Wishart · Status: superseded by 63

Reason: the UX spec applies content templates and review flows per language
(A42) while units and workflow live in the project partition. Deriving
unit and step ids from the catalog (`fia@1/gen-p1`) makes instantiation a
grow-only set: two admins selecting the same template offline emit the same
events and no clone job, ordered insert or server step exists. A lane's
step registers override project-wide ones, which override the old
whole-document config, so nothing existing changes. Reverse if: partners
need one lane to diverge from a template's structure; then hand-added
units already coexist, and a per-lane unit-set event is the next step.
