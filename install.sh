#!/bin/bash
set -e

APP="mogy"
REPO="minhtranin/mogy"
BIN_DIR="$HOME/.local/bin"
ICON_DIR="$HOME/.local/share/icons"
DESKTOP_DIR="$HOME/.local/share/applications"

echo "Installing $APP..."

APPIMAGE_URL=$(curl -s "https://api.github.com/repos/${REPO}/releases/latest" \
  | grep -o "https://.*amd64\.AppImage\"" | tr -d '"' | head -1)

if [ -z "$APPIMAGE_URL" ]; then
  echo "Error: could not find latest AppImage release"
  exit 1
fi

mkdir -p "$BIN_DIR" "$ICON_DIR" "$DESKTOP_DIR"

echo "Downloading AppImage..."
curl -L "$APPIMAGE_URL" -o "$BIN_DIR/$APP"
chmod +x "$BIN_DIR/$APP"

echo "Extracting icon..."
cd /tmp
"$BIN_DIR/$APP" --appimage-extract usr/share/icons 2>/dev/null || \
"$BIN_DIR/$APP" --appimage-extract *.png 2>/dev/null || true

ICON_SRC=$(find /tmp/squashfs-root -name "*.png" | sort | tail -1)
if [ -n "$ICON_SRC" ]; then
  cp "$ICON_SRC" "$ICON_DIR/$APP.png"
  rm -rf /tmp/squashfs-root
else
  # Fallback: download from repo
  curl -sL "https://raw.githubusercontent.com/${REPO}/master/src-tauri/icons/128x128.png" \
    -o "$ICON_DIR/$APP.png"
fi

echo "Creating desktop entry..."
cat > "$DESKTOP_DIR/$APP.desktop" << EOF
[Desktop Entry]
Name=Mogy
Comment=Keyboard-driven MongoDB query UI
Exec=$BIN_DIR/$APP
Icon=$ICON_DIR/$APP.png
Type=Application
Categories=Development;Database;
Terminal=false
StartupWMClass=mogy
EOF

update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true

echo ""
echo "Mogy installed!"
echo "  Binary:  $BIN_DIR/$APP"
echo "  Run:     mogy"
echo ""

if ! echo "$PATH" | grep -q "$BIN_DIR"; then
  echo "Note: add to PATH:"
  echo "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc && source ~/.bashrc"
fi
