#!/bin/bash

###############################################################################
# Production Server Initialization Script (Non-Interactive)
#
# Usage:
#   REPO_URL=git@github.com:user/repo.git bash init-production.sh
#   或
#   bash init-production.sh --repo git@github.com:user/repo.git
#   或
#   bash init-production.sh --skip-repo  # 跳过仓库克隆
#
# Environment Variables:
#   REPO_URL          - GitHub repository URL (可选)
#   SKIP_CONFIRMATION - 设置为 "true" 跳过确认提示 (默认跳过，用于自动化)
#
# Description:
#   - Installs Node.js, PM2, Nginx, PostgreSQL client
#   - Configures 2GB swap for memory optimization
#   - Sets up production-grade security configurations
#   - Configures Nginx with performance optimizations
#   - Prepares environment for automated deployment
#
# Run this script on a fresh Alibaba Cloud Linux 3 ECS instance
###############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse command line arguments
SKIP_REPO=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --repo)
      REPO_URL="$2"
      shift 2
      ;;
    --skip-repo)
      SKIP_REPO=true
      shift
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      echo "Usage: bash init-production.sh [--repo <url>] [--skip-repo]"
      exit 1
      ;;
  esac
done

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}  Production Server Initialization (Automated)${NC}"
echo -e "${BLUE}================================================${NC}"
echo -e "Time: $(date '+%Y-%m-%d %H:%M:%S')"
echo -e "${BLUE}================================================${NC}"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}❌ Please run as root (or use sudo)${NC}"
  exit 1
fi

# Non-interactive mode - log warning but continue
echo -e "${RED}⚠️  WARNING: Initializing PRODUCTION server in non-interactive mode${NC}"
echo -e "${YELLOW}Script will proceed automatically...${NC}"
echo ""

# Step 1: Update system packages
echo -e "${YELLOW}📦 Step 1/11: Updating system packages...${NC}"
yum update -y
echo -e "${GREEN}✅ System packages updated${NC}"
echo ""

# Step 2: Install basic utilities
echo -e "${YELLOW}🛠️  Step 2/11: Installing basic utilities...${NC}"
yum install -y git curl wget vim htop fail2ban
echo -e "${GREEN}✅ Basic utilities installed${NC}"
echo ""

# Step 3: Configure fail2ban for SSH protection
echo -e "${YELLOW}🔒 Step 3/11: Configuring fail2ban...${NC}"
systemctl enable fail2ban
systemctl start fail2ban
echo -e "${GREEN}✅ fail2ban configured and started${NC}"
echo ""

# Step 4: Install Node.js 20
echo -e "${YELLOW}📦 Step 4/11: Installing Node.js 20...${NC}"

# Install using NodeSource repository
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
yum install -y nodejs

# Verify installation
NODE_VERSION=$(node -v)
NPM_VERSION=$(npm -v)
echo -e "Node.js version: ${GREEN}$NODE_VERSION${NC}"
echo -e "npm version: ${GREEN}$NPM_VERSION${NC}"
echo -e "${GREEN}✅ Node.js 20 installed successfully${NC}"
echo ""

# Step 5: Install pnpm and PM2
echo -e "${YELLOW}📦 Step 5/11: Installing pnpm and PM2...${NC}"
npm install -g pnpm pm2
pm2 startup systemd -u root --hp /root
systemctl enable pm2-root

# Configure PM2 for production
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:compress true

echo -e "${GREEN}✅ pnpm and PM2 installed and configured with log rotation${NC}"
echo ""

# Step 6: Install PostgreSQL client
echo -e "${YELLOW}🗄️  Step 6/11: Installing PostgreSQL client...${NC}"
yum install -y postgresql
echo -e "${GREEN}✅ PostgreSQL client installed${NC}"
echo ""

# Step 7: Install and configure Nginx
echo -e "${YELLOW}🌐 Step 7/11: Installing and configuring Nginx...${NC}"
yum install -y nginx

# Create Nginx configuration for production with optimizations
cat > /etc/nginx/conf.d/production.conf << 'EOF'
# Rate limiting zone
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=100r/s;
limit_conn_zone $binary_remote_addr zone=conn_limit:10m;

server {
    listen 80;
    server_name _;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;

    # Increase client body size for file uploads
    client_max_body_size 50M;

    # Enable gzip compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss application/rss+xml font/truetype font/opentype application/vnd.ms-fontobject image/svg+xml;

    # Next.js app
    location / {
        # Rate limiting
        limit_req zone=api_limit burst=20 nodelay;
        limit_conn conn_limit 10;

        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeouts
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;

        # Buffer settings
        proxy_buffering on;
        proxy_buffer_size 4k;
        proxy_buffers 8 4k;
        proxy_busy_buffers_size 8k;
    }

    # Health check endpoint (no rate limiting)
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }

    # Block access to sensitive files
    location ~ /\. {
        deny all;
        access_log off;
        log_not_found off;
    }

    # Access and error logs
    access_log /var/log/nginx/production_access.log;
    error_log /var/log/nginx/production_error.log warn;
}
EOF

# Test Nginx configuration
nginx -t

# Enable and start Nginx
systemctl enable nginx
systemctl start nginx
echo -e "${GREEN}✅ Nginx installed and configured with production optimizations${NC}"
echo ""

# Step 8: Configure swap (2GB)
echo -e "${YELLOW}💾 Step 8/11: Configuring 2GB swap file...${NC}"

# Check if swap already exists
if swapon --show | grep -q '/swapfile'; then
  echo -e "${YELLOW}⚠️  Swap file already exists, skipping...${NC}"
else
  # Create 2GB swap file
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile

  # Make swap permanent
  echo '/swapfile none swap sw 0 0' >> /etc/fstab

  # Configure swappiness for production (even lower for better performance)
  sysctl vm.swappiness=5
  echo 'vm.swappiness=5' >> /etc/sysctl.conf

  echo -e "${GREEN}✅ 2GB swap file created and configured${NC}"
fi

# Show current memory status
echo ""
echo "Current memory status:"
free -h
echo ""

# Step 9: Create project directory structure
echo -e "${YELLOW}📁 Step 9/11: Creating project directory structure...${NC}"
mkdir -p /var/www/production
mkdir -p /var/backups/database/production
mkdir -p /var/log/production

# Set permissions
chown -R root:root /var/www/production
chmod -R 755 /var/www/production

echo -e "${GREEN}✅ Directory structure created${NC}"
echo ""

# Step 10: Set up GitHub SSH key
echo -e "${YELLOW}🔑 Step 10/11: Setting up SSH for GitHub...${NC}"

mkdir -p ~/.ssh
chmod 700 ~/.ssh

# Generate SSH key if it doesn't exist
if [ ! -f ~/.ssh/github_actions_prod ]; then
  ssh-keygen -t ed25519 -C "production-server" -f ~/.ssh/github_actions_prod -N ""
  echo -e "${GREEN}✅ SSH key generated${NC}"
  echo ""
  echo -e "${YELLOW}⚠️  IMPORTANT: Add this public key to your GitHub repository's deploy keys:${NC}"
  echo ""
  cat ~/.ssh/github_actions_prod.pub
  echo ""
  echo -e "${YELLOW}GitHub Settings > Deploy keys > Add deploy key${NC}"
  echo -e "${YELLOW}Title: Production Server${NC}"
  echo -e "${YELLOW}Allow write access: NO (read-only is sufficient)${NC}"
else
  echo -e "${YELLOW}⚠️  SSH key already exists${NC}"
fi

# Configure SSH for GitHub
cat >> ~/.ssh/config << 'EOF'

Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/github_actions_prod
    StrictHostKeyChecking no
EOF

chmod 600 ~/.ssh/config
echo -e "${GREEN}✅ SSH configured for GitHub${NC}"
echo ""

# Step 11: Clone repository and initial setup
echo -e "${YELLOW}📦 Step 11/11: Initial repository setup...${NC}"

if [ "$SKIP_REPO" = true ]; then
  echo -e "${YELLOW}⚠️  Skipping repository clone (--skip-repo flag set)${NC}"
elif [ -n "$REPO_URL" ]; then
  cd /var/www/production

  # Test SSH connection to GitHub
  echo "Testing GitHub SSH connection..."
  ssh -T git@github.com || true

  # Clone repository
  echo "Cloning repository..."
  git clone $REPO_URL .

  # Install dependencies
  cd frontend
  pnpm install

  echo -e "${GREEN}✅ Repository cloned and dependencies installed${NC}"
else
  echo -e "${YELLOW}⚠️  Skipping repository clone (no REPO_URL provided)${NC}"
  echo -e "${YELLOW}   To clone later, run: cd /var/www/production && git clone <repo-url> .${NC}"
fi
echo ""

# Summary
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}  ✅ Production Server Initialization Complete!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo -e "${YELLOW}🔒 Security Checklist:${NC}"
echo "- [x] fail2ban installed for SSH protection"
echo "- [x] Nginx security headers configured"
echo "- [x] Rate limiting enabled"
echo "- [x] Log rotation configured"
echo "- [ ] TODO: Configure SSL/TLS certificate (use Let's Encrypt)"
echo "- [ ] TODO: Configure firewall rules (allow only 80, 443, 22)"
echo "- [ ] TODO: Set up monitoring and alerting"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Add the SSH public key to GitHub (shown above)"
echo ""
echo "2. Create /var/www/production/frontend/.env file with production environment variables:"
echo "   - DATABASE_URL"
echo "   - NEXT_PUBLIC_API_URL"
echo "   - APP_ENVIRONMENT=production (注意：不要设置 NODE_ENV，它由 Next.js 自动管理)"
echo "   - Other required environment variables"
echo ""
echo "3. Add GitHub Actions secrets:"
echo "   - PRODUCTION_SERVER_HOST: $(curl -s ifconfig.me)"
echo "   - PRODUCTION_SERVER_SSH_KEY: (content of the private key shown below)"
echo "   - PRODUCTION_DATABASE_URL: (your production database connection string)"
echo ""
echo "Private key for GitHub Actions (copy this entire content):"
echo "-----------------------------------------------------------"
cat ~/.ssh/github_actions_prod
echo "-----------------------------------------------------------"
echo ""
echo "4. Configure GitHub Environment protection rules:"
echo "   - Go to Settings > Environments > production"
echo "   - Add required reviewers"
echo "   - Set deployment branch to 'main' only"
echo ""
echo "5. (Optional but recommended) Set up SSL certificate:"
echo "   sudo yum install certbot python3-certbot-nginx -y"
echo "   sudo certbot --nginx -d yourdomain.com"
echo ""
echo -e "${BLUE}Server Information:${NC}"
echo "Public IP: $(curl -s ifconfig.me)"
echo "Node.js: $(node -v)"
echo "npm: $(npm -v)"
echo "PM2: $(pm2 -v)"
echo "Nginx: $(nginx -v 2>&1 | grep -oP 'nginx/\K[0-9.]+')"
echo "PostgreSQL client: $(psql --version | grep -oP '\d+\.\d+')"
echo ""
echo -e "${GREEN}✅ Production server is ready for automated deployments!${NC}"
echo -e "${RED}⚠️  Remember: Always test in staging before deploying to production${NC}"
echo ""
