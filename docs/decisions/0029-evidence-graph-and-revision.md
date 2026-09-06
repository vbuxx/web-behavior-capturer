# ADR 0029 Evidence Graph Revision

Status: accepted for Phase 2 foundation
Date: 6 September 2026

## Decision

Every new 1.6 capture writes `evidence-graph.json` with schema `1.0.0` and a revision ID. The manifest references its relative path and SHA-256; the session index repeats the checksum and validates the graph before a package can be reopened or queried.

The graph contains input, observable-state, mutation, animation, network-completion, visual-checkpoint, and probe-run nodes. Edges carry class, evidence refs, target/navigation scope, clock uncertainty, and limitation. Natural observations are direct only when they share evidence; other relations are correlated or explicitly unknown.

## Consequence

Agents can query a compact provenance graph without reading raw JSONL. Annotation or probe corrections must create a new graph/contract revision; the original evidence files remain immutable. Focus, visibility, and attributes are currently explicit unknowns until state-fingerprint checkpoints are added.
