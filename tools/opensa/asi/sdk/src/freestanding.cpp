// Freestanding CRT builtins. Under -nostdlib there is no libc, yet GCC still synthesizes calls to these four
// from ordinary loops/struct copies. Provide minimal versions so the .asi links with KERNEL32 only. Compiled
// with -fno-tree-loop-distribute-patterns (see the Makefile) so these loops are NOT turned into self-calls.
#include <cstddef>

extern "C" {

void* memset(void* dst, int value, size_t count) {
  unsigned char* p = static_cast<unsigned char*>(dst);
  for (size_t i = 0; i < count; ++i) {
    p[i] = static_cast<unsigned char>(value);
  }
  return dst;
}

void* memcpy(void* dst, const void* src, size_t count) {
  unsigned char* d = static_cast<unsigned char*>(dst);
  const unsigned char* s = static_cast<const unsigned char*>(src);
  for (size_t i = 0; i < count; ++i) {
    d[i] = s[i];
  }
  return dst;
}

void* memmove(void* dst, const void* src, size_t count) {
  unsigned char* d = static_cast<unsigned char*>(dst);
  const unsigned char* s = static_cast<const unsigned char*>(src);
  if (d < s) {
    for (size_t i = 0; i < count; ++i) {
      d[i] = s[i];
    }
  } else {
    for (size_t i = count; i > 0; --i) {
      d[i - 1] = s[i - 1];
    }
  }
  return dst;
}

size_t strlen(const char* text) {
  size_t len = 0;
  while (text[len]) {
    ++len;
  }
  return len;
}

}  // extern "C"
