#!/bin/bash
# Build the NanoClaw Teams sidecar container image

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

IMAGE_NAME="nanoclaw-teams-sidecar"
TAG="${1:-latest}"
CONTAINER_RUNTIME="${CONTAINER_RUNTIME:-docker}"

echo "Building Teams sidecar container image..."
echo "Image: ${IMAGE_NAME}:${TAG}"

${CONTAINER_RUNTIME} build -t "${IMAGE_NAME}:${TAG}" .

echo ""
echo "Build complete!"
echo "Image: ${IMAGE_NAME}:${TAG}"
echo ""
echo "Test with:"
echo "  ${CONTAINER_RUNTIME} run --rm -p 3978:3978 -e TEAMS_APP_ID=test -e TEAMS_APP_SECRET=test ${IMAGE_NAME}:${TAG}"
