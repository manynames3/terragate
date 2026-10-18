PYTHON ?= .venv/bin/python
EVAL = PYTHONPATH=apps/api:. $(PYTHON) -m evaluations.cli

.PHONY: test eval-validate eval-offline eval-live-help

test:
	cd apps/api && OPENAI_API_KEY= LANGSMITH_TRACING=false ../../$(PYTHON) -m pytest -q
	PYTHONPATH=apps/api:. $(PYTHON) -m pytest -q evaluations/tests

eval-validate:
	$(EVAL) validate

eval-offline:
	$(EVAL) run --reviewer baseline --out evaluations/results/baseline-offline-$$(date -u +%Y%m%dT%H%M%SZ).json
	$(EVAL) run --reviewer candidate --out evaluations/results/candidate-offline-$$(date -u +%Y%m%dT%H%M%SZ).json

eval-live-help:
	@echo 'Live runs require OPENAI_API_KEY, --mode live --allow-live, a budget, and a fresh output path. See docs/evaluations.md.'
