#!/bin/bash
# ============================================
# Server Deployment Mode
# Deploy on the server directly (legacy mode)
# Run this script on the ECS server (staging or production)
# ============================================

deploy_on_server() {
    local ENV=$1

    # Set environment-specific variables
    if [ "$ENV" == "production" ]; then
        PROJECT_DIR="/var/www/production"
        BACKUP_DIR="/var/backups/database/production"
        PM2_APP_NAME="production-app"
        BACKUP_RETENTION=30
    elif [ "$ENV" == "staging" ]; then
        PROJECT_DIR="/var/www/staging"
        BACKUP_DIR="/var/backups/database/staging"
        PM2_APP_NAME="staging-app"
        BACKUP_RETENTION=10
    else
        # dev environment
        PROJECT_DIR="/var/www/dev"
        BACKUP_DIR="/var/backups/database/dev"
        PM2_APP_NAME="dev-app"
        BACKUP_RETENTION=5
    fi

    # Load environment variables
    if [ ! -f "$PROJECT_DIR/apps/web/.env" ]; then
        log_error ".env file not found at $PROJECT_DIR/apps/web/.env"
        exit 1
    fi

    # Source .env to get DATABASE_URL
    export $(grep -v '^#' $PROJECT_DIR/apps/web/.env | xargs)

    if [ -z "$DATABASE_URL" ]; then
        log_error "DATABASE_URL not set in .env file"
        exit 1
    fi

    # Confirmation for production
    if [ "$ENV" == "production" ]; then
        log_warn "⚠️  WARNING: You are about to deploy to PRODUCTION!"
        echo ""
        read -p "Type 'YES' to confirm production deployment: " CONFIRMATION

        if [ "$CONFIRMATION" != "YES" ]; then
            log_error "Deployment cancelled"
            exit 1
        fi
        echo ""
    fi

    echo -e "${BLUE}================================================${NC}"
    echo -e "${BLUE}  🚀 Deployment to ${ENV^^}${NC}"
    echo -e "${BLUE}================================================${NC}"
    echo -e "Time: $(date '+%Y-%m-%d %H:%M:%S')"
    echo -e "Project: $PROJECT_DIR"
    echo -e "${BLUE}================================================${NC}"
    echo ""

    # Navigate to project directory
    cd $PROJECT_DIR

    # Step 1: Pull latest code
    log_info "📦 Step 1/6: Pulling latest code..."
    CURRENT_COMMIT=$(git rev-parse --short HEAD)
    echo "Current commit: $CURRENT_COMMIT"

    git fetch origin
    git reset --hard origin/main

    NEW_COMMIT=$(git rev-parse --short HEAD)
    echo "New commit: $NEW_COMMIT"

    if [ "$CURRENT_COMMIT" == "$NEW_COMMIT" ]; then
        log_warn "⚠️  No new commits to deploy"
    else
        log_success "Code updated from $CURRENT_COMMIT to $NEW_COMMIT"
    fi
    echo ""

    # Step 2: Install dependencies
    log_info "📦 Step 2/6: Installing dependencies..."
    cd apps/web
    pnpm install
    log_success "Dependencies installed"
    echo ""

    # Step 3: Backup database
    log_info "💾 Step 3/6: Creating database backup..."
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    mkdir -p $BACKUP_DIR

    # Extract connection info
    DB_HOST=$(echo $DATABASE_URL | sed -E 's|postgresql://[^@]+@([^:/]+).*|\1|')
    DB_PORT=$(echo $DATABASE_URL | sed -E 's|.*:([0-9]+)/.*|\1|')
    DB_NAME=$(echo $DATABASE_URL | sed -E 's|.*/([^?]+).*|\1|')
    DB_USER=$(echo $DATABASE_URL | sed -E 's|postgresql://([^:]+):.*|\1|')
    DB_PASS=$(echo $DATABASE_URL | sed -E 's|postgresql://[^:]+:([^@]+)@.*|\1|')

    BACKUP_FILE="${BACKUP_DIR}/backup_${TIMESTAMP}.sql"
    echo "Creating backup: $(basename ${BACKUP_FILE}.gz)"
    PGPASSWORD=$DB_PASS pg_dump -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -F p -f $BACKUP_FILE

    # Compress backup
    gzip $BACKUP_FILE

    # Verify backup
    if [ -f "${BACKUP_FILE}.gz" ]; then
        BACKUP_SIZE=$(stat -c%s "${BACKUP_FILE}.gz" 2>/dev/null || stat -f%z "${BACKUP_FILE}.gz")
        echo -e "Backup created: ${GREEN}$(basename ${BACKUP_FILE}.gz)${NC} (${BACKUP_SIZE} bytes)"

        # Validate minimum size
        if [ $BACKUP_SIZE -lt 1024 ]; then
            log_error "Backup file is too small (${BACKUP_SIZE} bytes). Aborting deployment."
            exit 1
        fi

        # Cleanup old backups
        cd $BACKUP_DIR
        ls -t backup_*.sql.gz 2>/dev/null | tail -n +$((BACKUP_RETENTION + 1)) | xargs -r rm -f
        cd $PROJECT_DIR/apps/web
    else
        log_error "Backup failed! Aborting deployment."
        exit 1
    fi
    echo ""

    # Step 4: Run database migrations
    log_info "🗄️  Step 4/6: Running database migrations..."

    echo "Checking migration status..."
    npx prisma migrate status

    echo ""
    echo "Deploying migrations..."
    npx prisma migrate deploy 2>&1 | tee migration.log

    if [ ${PIPESTATUS[0]} -ne 0 ]; then
        log_error "Migration failed! Attempting automatic rollback..."

        # Rollback
        gunzip -c "${BACKUP_FILE}.gz" | PGPASSWORD=$DB_PASS psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME

        if [ $? -eq 0 ]; then
            log_success "Database rolled back successfully to: $(basename ${BACKUP_FILE}.gz)"
        else
            log_error "Rollback failed! Manual intervention required."
            echo "Backup location: ${BACKUP_FILE}.gz"
        fi
        exit 1
    fi

    log_success "Migrations completed successfully"
    echo ""

    # Step 5: Build frontend
    log_info "🏗️  Step 5/6: Building frontend..."
    export APP_ENVIRONMENT=production
    export NODE_OPTIONS="--max-old-space-size=768"

    echo "Starting build process (this may take a few minutes)..."
    pnpm build 2>&1 | tee build.log

    if [ ${PIPESTATUS[0]} -ne 0 ]; then
        log_error "Build failed! Check build.log for details."
        tail -n 50 build.log
        exit 1
    fi

    log_success "Build completed successfully"
    echo ""

    # Step 6: Restart application
    log_info "🔄 Step 6/6: Restarting application..."

    # Check if app is running
    if pm2 list | grep -q "$PM2_APP_NAME"; then
        echo "Restarting existing application..."
        pm2 restart $PM2_APP_NAME --update-env
    else
        echo "Starting new application instance..."
        cd $PROJECT_DIR/apps/web
        pm2 start pnpm --name $PM2_APP_NAME -- start
    fi

    pm2 save
    log_success "Application restart command executed"
    echo ""

    # Wait for application to start
    echo "Waiting for application to initialize..."
    sleep 10

    # Verify application is running
    if pm2 list | grep -q "$PM2_APP_NAME.*online"; then
        log_success "Application is running"
        pm2 status $PM2_APP_NAME
    else
        log_error "Application failed to start!"
        pm2 logs $PM2_APP_NAME --lines 50 --nostream
        exit 1
    fi

    echo ""
    log_success "================================================"
    log_success "  ✅ Deployment Completed Successfully!"
    log_success "================================================"
    echo -e "Environment: ${GREEN}$ENV${NC}"
    echo -e "Deployed commit: ${GREEN}$NEW_COMMIT${NC}"
    echo -e "Backup location: ${GREEN}${BACKUP_FILE}.gz${NC}"
    echo -e "Deployment time: ${GREEN}$(date '+%Y-%m-%d %H:%M:%S')${NC}"
    echo ""

    # Show application status
    echo -e "${BLUE}Application Status:${NC}"
    pm2 status $PM2_APP_NAME
    echo ""

    # Show memory usage
    echo -e "${BLUE}Memory Usage:${NC}"
    free -h | grep Mem
    echo ""

    # Show disk usage
    echo -e "${BLUE}Disk Usage:${NC}"
    df -h $PROJECT_DIR
    echo ""

    if [ "$ENV" == "production" ]; then
        log_warn "⚠️  Post-Deployment Checklist:"
        echo "1. Verify application is accessible"
        echo "2. Test critical user flows"
        echo "3. Monitor error logs for 15-20 minutes"
        echo "4. Check application performance metrics"
        echo ""
        echo "To monitor logs in real-time:"
        echo "  pm2 logs $PM2_APP_NAME"
        echo ""
    fi

    log_success "All steps completed successfully!"
    echo ""
}
