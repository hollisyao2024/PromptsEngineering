#!/bin/bash

###############################################################################
# Universal Deployment Script
#
# Usage: ./deploy.sh <trigger-mode> <environment>
#
# Arguments:
#   trigger-mode: local | ci | server
#     - local:  Deploy from local machine via SSH + rsync
#     - ci:     Deploy from CI/CD (GitHub Actions)
#     - server: Deploy on the server directly (legacy mode)
#
#   environment: dev | staging | production
#     - dev:        Local development environment
#     - staging:    Staging environment
#     - production: Production environment
#
# Examples:
#   ./deploy.sh local staging     # Deploy from local to staging
#   ./deploy.sh local production  # Deploy from local to production
#   ./deploy.sh ci staging        # Deploy from CI/CD to staging
#   ./deploy.sh server staging    # Deploy on server (run on ECS)
#
###############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Log functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ============================================================
# Argument Validation
# ============================================================

TRIGGER_MODE=${1:-}
ENV=${2:-staging}

if [[ -z "$TRIGGER_MODE" ]]; then
    log_error "Missing trigger mode"
    echo ""
    echo "Usage: $0 <trigger-mode> <environment>"
    echo ""
    echo "trigger-mode:"
    echo "  local   - Deploy from local machine (SSH + rsync)"
    echo "  ci      - Deploy from CI/CD (GitHub Actions)"
    echo "  server  - Deploy on server directly"
    echo ""
    echo "environment:"
    echo "  dev        - Local development"
    echo "  staging    - Staging environment"
    echo "  production - Production environment"
    echo ""
    echo "Examples:"
    echo "  $0 local staging"
    echo "  $0 ci production"
    echo "  $0 server staging"
    exit 1
fi

# Validate trigger mode
if [[ "$TRIGGER_MODE" != "local" && "$TRIGGER_MODE" != "ci" && "$TRIGGER_MODE" != "server" ]]; then
    log_error "Invalid trigger mode: $TRIGGER_MODE"
    log_error "Must be one of: local | ci | server"
    exit 1
fi

# Validate environment
if [[ "$ENV" != "dev" && "$ENV" != "staging" && "$ENV" != "production" ]]; then
    log_error "Invalid environment: $ENV"
    log_error "Must be one of: dev | staging | production"
    exit 1
fi

log_info "============================================"
log_info "  Deployment Script"
log_info "============================================"
log_info "Trigger Mode: $TRIGGER_MODE"
log_info "Environment:  $ENV"
log_info "Time:         $(date '+%Y-%m-%d %H:%M:%S')"
log_info "============================================"
echo ""

# ============================================================
# Route to Appropriate Deployment Function
# ============================================================

case "$TRIGGER_MODE" in
    "local")
        source "$(dirname "$0")/deploy-local-mode.sh"
        deploy_from_local "$ENV"
        ;;
    "ci")
        source "$(dirname "$0")/deploy-ci-mode.sh"
        deploy_from_ci "$ENV"
        ;;
    "server")
        source "$(dirname "$0")/deploy-server-mode.sh"
        deploy_on_server "$ENV"
        ;;
esac

log_success "============================================"
log_success "  ✅ Deployment Completed!"
log_success "============================================"
log_info "Mode:        $TRIGGER_MODE"
log_info "Environment: $ENV"
log_info "Time:        $(date '+%Y-%m-%d %H:%M:%S')"
echo ""
