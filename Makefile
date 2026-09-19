.PHONY: help setup prod dev logs stop restart shell

# Farbige Terminalausgabe
BLUE := \033[1;34m
GREEN := \033[1;32m
YELLOW := \033[1;33m
RED := \033[1;31m
NC := \033[0m

help:
	@echo "$(BLUE)Scanny - Befehlsübersicht:$(NC)"
	@echo "  $(GREEN)make setup$(NC)    - Ersteinrichtung (.env aus Vorlage, Docker Build, Start)"
	@echo "  $(GREEN)make prod$(NC)     - Produktions-Container neu bauen und starten"
	@echo "  $(GREEN)make dev$(NC)      - Lokalen Entwicklungsserver auf Port 3005 starten"
	@echo "  $(GREEN)make logs$(NC)     - Container-Logs live verfolgen"
	@echo "  $(GREEN)make stop$(NC)     - Container stoppen"
	@echo "  $(GREEN)make restart$(NC)  - Container neu starten"
	@echo "  $(GREEN)make shell$(NC)    - Interaktive Shell im Container öffnen"

setup:
	@if [ ! -f .env ]; then \
		echo "$(YELLOW).env nicht gefunden - kopiere aus .env.example...$(NC)"; \
		cp .env.example .env; \
		if [ "$$(uname)" = "Darwin" ]; then \
			sed -i '' "s/DEINNAME/$$USER/g" .env; \
		else \
			sed -i "s/DEINNAME/$$USER/g" .env; \
		fi; \
		echo "$(GREEN).env angelegt und DEINNAME durch $$USER ersetzt.$(NC)"; \
	fi
	@SCANNY_PATH_VAL=$$(grep -E '^SCANNY_PATH=' .env | cut -d '=' -f2- | tr -d '"' | tr -d "'"); \
	if echo "$$SCANNY_PATH_VAL" | grep -q "DEINNAME" || echo "$$SCANNY_PATH_VAL" | grep -q "//"; then \
		echo "$(RED)Fehler: SCANNY_PATH in .env ist ungültig ($$SCANNY_PATH_VAL). Bitte manuell korrigieren!$(NC)"; \
		exit 1; \
	fi; \
	if [ -z "$$SCANNY_PATH_VAL" ]; then \
		echo "$(RED)Fehler: SCANNY_PATH fehlt oder ist leer in .env.$(NC)"; \
		exit 1; \
	fi; \
	if ! mkdir -p "$$SCANNY_PATH_VAL"; then \
		echo "$(RED)Fehler: Verzeichnis $$SCANNY_PATH_VAL konnte nicht angelegt werden.$(NC)"; \
		exit 1; \
	fi; \
	echo "$(GREEN)Verzeichnis $$SCANNY_PATH_VAL sichergestellt.$(NC)"
	@echo "$(BLUE)Baue Scanny Docker-Image...$(NC)"
	docker compose build
	@echo "$(BLUE)Starte Scanny Container...$(NC)"
	docker compose up -d
	@echo "$(GREEN)✓ Scanny erfolgreich gestartet!$(NC)"
	@echo "$(GREEN)App running at http://localhost:3004$(NC)"

prod:
	@echo "$(BLUE)Baue und starte Scanny im Produktionsmodus...$(NC)"
	docker compose build
	docker compose up -d
	@echo "$(GREEN)✓ Scanny läuft unter http://localhost:3004$(NC)"

dev:
	@echo "$(BLUE)Starte lokalen Dev-Server auf Port 3005...$(NC)"
	PORT=3005 npm run dev

logs:
	docker compose logs -f

stop:
	@echo "$(YELLOW)Stoppe Scanny Container...$(NC)"
	docker compose down

restart:
	@echo "$(YELLOW)Starte Scanny Container neu...$(NC)"
	docker compose restart
	@echo "$(GREEN)✓ Container neu gestartet: http://localhost:3004$(NC)"

shell:
	docker compose exec scanny /bin/bash
