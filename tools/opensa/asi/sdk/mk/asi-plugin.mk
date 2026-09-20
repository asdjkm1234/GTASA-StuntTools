# The shared .asi build rules — MinGW-w64 cross build (macOS → Win32 i386). A plugin's Makefile sets PLUGIN_OUT
# (and optionally PLUGIN_SRC / PLUGIN_DEFS), then includes this fragment. Requires: brew install mingw-w64.
#
# Build modes (the plugin's npm scripts wrap these):
#   make            verify-only / dry run — patches nothing, logs the full plan
#   make APPLY=1    the shipping build
#   make DEBUG=1    verbose: dump every site's verify status; the plugin's own trace flags are its to add
# Per-fix bisection is the plugin's business, through the shared knob:
#   make APPLY=1 EXTRA_CXXFLAGS='-DPM_FIX_X=1 -DPM_FIX_Y=0'
# (the knob is deliberately NOT named after any one plugin's macro prefix).

ASI_SDK_DIR := $(dir $(lastword $(MAKEFILE_LIST)))..

CXX      := i686-w64-mingw32-g++
OUT_DIR  := $(dir $(PLUGIN_OUT))
SRC      := $(PLUGIN_SRC) $(ASI_SDK_DIR)/src/freestanding.cpp

# 32-bit (SA is i386); C++17; no CRT (an ASI uses Win32 APIs only) so the import table is KERNEL32-only and it
# loads on any Windows SA runs on; DllMain is the raw DLL entry; strip.
# -fno-tree-loop-distribute-patterns: keep the freestanding memset/strlen loops from being rewritten into calls
# to themselves (there is no libc to fall back to under -nostdlib).
# -I<sdk>/include so a plugin includes the framework as <asi/...>.
CXXFLAGS := -std=c++17 -O2 -Wall -Wextra -fno-exceptions -fno-rtti -fno-tree-loop-distribute-patterns \
            -I$(ASI_SDK_DIR)/include
# --no-insert-timestamp: zero the PE/export timestamps so identical sources build byte-identical DLLs (the
# migration referee is a plain hash compare; the banner's __DATE__/__TIME__ still moves — pin SOURCE_DATE_EPOCH
# when an A/B needs the whole file stable).
LDFLAGS  := -shared -nostdlib -Wl,--entry,_DllMain@12 -Wl,--exclude-all-symbols -Wl,--no-insert-timestamp -s

ifeq ($(APPLY),1)
CXXFLAGS += -DASI_APPLY=1
endif
ifeq ($(DEBUG),1)
# Every DEBUG switch is read inside an APPLY build (the pre-apply site dump, the plugins' own traces), so
# `make DEBUG=1` alone would build something byte-identical to a plain verify-only run while looking like a
# distinct mode. Refuse instead of building a lie.
ifneq ($(APPLY),1)
$(error DEBUG=1 requires APPLY=1 — a verify-only build has nothing to trace)
endif
CXXFLAGS += -DASI_DEBUG=1 $(PLUGIN_DEBUG_DEFS)
endif
# EXTRA_CXXFLAGS is the per-invocation knob (per-fix bisection); PLUGIN_DEFS is what a plugin's Makefile sets.
CXXFLAGS += $(PLUGIN_DEFS) $(EXTRA_CXXFLAGS)

# Every SDK header and every plugin header — editing either rebuilds (perfect-map's own HDRS used to miss
# src/patches/*.hpp, so a payload edit alone did not trigger a build).
HDRS := $(wildcard $(ASI_SDK_DIR)/include/asi/*.hpp) $(PLUGIN_HDRS)

.PHONY: all clean

all: $(PLUGIN_OUT)

$(PLUGIN_OUT): $(SRC) $(HDRS) | $(OUT_DIR)
	$(CXX) $(CXXFLAGS) $(SRC) -o $(PLUGIN_OUT) $(LDFLAGS) -lkernel32
	@echo "built $(PLUGIN_OUT)"

$(OUT_DIR):
	@mkdir -p $(OUT_DIR)

clean:
	@rm -rf $(OUT_DIR)
