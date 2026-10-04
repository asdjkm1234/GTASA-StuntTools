# perfect-cutscene.asi — the plugin's thin Makefile: identity + payload flags, then the SDK's shared rules.
# Wrapped by `npm run build:asi`. Requires: brew install mingw-w64 (provides i686-w64-mingw32-g++).

PLUGIN_OUT := dist/perfect-cutscene.asi
PLUGIN_SRC := src/dllmain.cpp
PLUGIN_HDRS := $(wildcard src/*.hpp) $(wildcard src/patches/*.hpp) src/generated/patches.hpp

# `make DEBUG=1` (build:debug) additionally traces this plugin's per-clump atomic decisions at runtime.
PLUGIN_DEBUG_DEFS := -DPC_CENSUS_LOG=1

include ../sdk/mk/asi-plugin.mk
