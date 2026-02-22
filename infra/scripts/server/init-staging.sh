#!/bin/bash

###############################################################################
# Staging Server Initialization Script (Non-Interactive)
#
# Usage:
#   REPO_URL=git@github.com:user/repo.git bash init-staging.sh
#   或
#   bash init-staging.sh --repo git@github.com:user/repo.git
#   或
#   bash init-staging.sh --skip-repo  # 跳过仓库克隆
#
# Environment Variables:
#   REPO_URL - GitHub repository URL (可选)
#
# Description:
#   - Installs Node.js, PM2, Nginx, PostgreSQL client
#   - Configures 2GB swap for 1GB RAM server
#   - Sets up project directory structure
#   - Configures Nginx reverse proxy
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
      echo "Usage: bash init-staging.sh [--repo <url>] [--skip-repo]"
      exit 1
      ;;
  esac
done

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}  Staging Server Initialization (Automated)${NC}"
echo -e "${BLUE}================================================${NC}"
echo -e "Time: $(date '+%Y-%m-%d %H:%M:%S')"
echo -e "${BLUE}================================================${NC}"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}❌ Please run as root (or use sudo)${NC}"
  exit 1
fi

# Step 1: Update system packages
echo -e "${YELLOW}📦 Step 1/10: Updating system packages...${NC}"
yum update -y
echo -e "${GREEN}✅ System packages updated${NC}"
echo ""

# Step 2: Install basic utilities
echo -e "${YELLOW}🛠️  Step 2/10: Installing basic utilities...${NC}"
yum install -y git curl wget vim htop
echo -e "${GREEN}✅ Basic utilities installed${NC}"
echo ""

# Step 3: Install Node.js 20
echo -e "${YELLOW}📦 Step 3/10: Installing Node.js 20...${NC}"

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

# Step 4: Install pnpm and PM2
echo -e "${YELLOW}📦 Step 4/10: Installing pnpm and PM2...${NC}"
npm install -g pnpm pm2
pm2 startup systemd -u root --hp /root
systemctl enable pm2-root
echo -e "${GREEN}✅ pnpm and PM2 installed and configured${NC}"
echo ""

# Step 5: Install PostgreSQL client
echo -e "${YELLOW}🗄️  Step 5/10: Installing PostgreSQL client...${NC}"
yum install -y postgresql
echo -e "${GREEN}✅ PostgreSQL client installed${NC}"
echo ""

# Step 6: Install and configure Nginx
echo -e "${YELLOW}🌐 Step 6/10: Installing and configuring Nginx...${NC}"
yum install -y nginx

# Create Nginx configuration for staging
cat > /etc/nginx/conf.d/staging.conf << 'EOF'
server {
    listen 80;
    server_name _;

    # Increase client body size for file uploads
    client_max_body_size 50M;

    # Next.js app
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Increase timeout for long-running requests
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # Health check endpoint
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
}
EOF

# Test Nginx configuration
nginx -t

# Enable and start Nginx
systemctl enable nginx
systemctl start nginx
echo -e "${GREEN}✅ Nginx installed and configured${NC}"
echo ""

# Step 7: Configure swap (2GB for 1GB RAM)
echo -e "${YELLOW}💾 Step 7/10: Configuring 2GB swap file...${NC}"

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

  # Configure swappiness (lower value = less aggressive swapping)
  sysctl vm.swappiness=10
  echo 'vm.swappiness=10' >> /etc/sysctl.conf

  echo -e "${GREEN}✅ 2GB swap file created and configured${NC}"
fi

# Show current memory status
echo ""
echo "Current memory status:"
free -h
echo ""

# Step 8: Create project directory structure
echo -e "${YELLOW}📁 Step 8/10: Creating project directory structure...${NC}"
mkdir -p /var/www/staging
mkdir -p /var/backups/database/staging
mkdir -p /var/log/staging

# Set permissions
chown -R root:root /var/www/staging
chmod -R 755 /var/www/staging

echo -e "${GREEN}✅ Directory structure created${NC}"
echo ""

# Step 9: Set up GitHub SSH key
echo -e "${YELLOW}🔑 Step 9/10: Setting up SSH for GitHub...${NC}"

mkdir -p ~/.ssh
chmod 700 ~/.ssh

# Generate SSH key if it doesn't exist
if [ ! -f ~/.ssh/github_actions ]; then
  ssh-keygen -t ed25519 -C "staging-server" -f ~/.ssh/github_actions -N ""
  echo -e "${GREEN}✅ SSH key generated${NC}"
  echo ""
  echo -e "${YELLOW}⚠️  IMPORTANT: Add this public key to your GitHub repository's deploy keys:${NC}"
  echo ""
  cat ~/.ssh/github_actions.pub
  echo ""
  echo -e "${YELLOW}GitHub Settings > Deploy keys > Add deploy key${NC}"
  echo -e "${YELLOW}Allow write access: NO (read-only is sufficient)${NC}"
else
  echo -e "${YELLOW}⚠️  SSH key already exists${NC}"
fi

# Configure SSH for GitHub
cat >> ~/.ssh/config << 'EOF'

Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/github_actions
    StrictHostKeyChecking no
EOF

chmod 600 ~/.ssh/config
echo -e "${GREEN}✅ SSH configured for GitHub${NC}"
echo ""

# Step 10: Clone repository and initial setup
echo -e "${YELLOW}📦 Step 10/10: Initial repository setup...${NC}"

if [ "$SKIP_REPO" = true ]; then
  echo -e "${YELLOW}⚠️  Skipping repository clone (--skip-repo flag set)${NC}"
elif [ -n "$REPO_URL" ]; then
  cd /var/www/staging

  # Test SSH connection to GitHub
  echo "Testing GitHub SSH connection..."
  ssh -T git@github.com || true

  # Clone repository
  echo "Cloning repository..."
  git clone $REPO_URL .

  # Install dependencies
  cd apps/web
  pnpm install

  echo -e "${GREEN}✅ Repository cloned and dependencies installed${NC}"
else
  echo -e "${YELLOW}⚠️  Skipping repository clone (no REPO_URL provided)${NC}"
  echo -e "${YELLOW}   To clone later, run: cd /var/www/staging && git clone <repo-url> .${NC}"
fi
echo ""

# Summary
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}  ✅ Staging Server Initialization Complete!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Add the SSH public key to GitHub (shown above)"
echo "2. Create .env file with environment variables:"
echo "   - DATABASE_URL"
echo "   - NEXT_PUBLIC_API_URL"
echo "   - Other required environment variables"
echo ""
echo "3. Add GitHub Actions secrets:"
echo "   - STAGING_SERVER_HOST: $(curl -s ifconfig.me)"
echo "   - STAGING_SERVER_SSH_KEY: (content of the private key shown below)"
echo "   - STAGING_DATABASE_URL: (your staging database connection string)"
echo ""
echo "Private key for GitHub Actions (copy this entire content):"
echo "-----------------------------------------------------------"
cat ~/.ssh/github_actions
echo "-----------------------------------------------------------"
echo ""
echo "4. Test deployment by pushing to main branch"
echo ""
echo -e "${BLUE}Server Information:${NC}"
echo "Public IP: $(curl -s ifconfig.me)"
echo "Node.js: $(node -v)"
echo "npm: $(npm -v)"
echo "PM2: $(pm2 -v)"
echo "Nginx: $(nginx -v 2>&1 | grep -oP 'nginx/\K[0-9.]+')"
echo "PostgreSQL client: $(psql --version | grep -oP '\d+\.\d+')"
echo ""
echo -e "${GREEN}✅ Server is ready for automated deployments!${NC}"
echo ""
