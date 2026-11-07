import ctypes, sys, os
la = ctypes.CDLL("libarchive.so.13")
la.archive_read_new.restype = ctypes.c_void_p
la.archive_write_disk_new.restype = ctypes.c_void_p
la.archive_entry_pathname.restype = ctypes.c_char_p
la.archive_entry_pathname.argtypes = [ctypes.c_void_p]
la.archive_entry_set_pathname.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
la.archive_error_string.restype = ctypes.c_char_p
for f in ["archive_read_support_filter_all","archive_read_support_format_all","archive_read_free","archive_write_free","archive_read_data_skip"]:
    getattr(la,f).argtypes=[ctypes.c_void_p]
la.archive_read_open_filename.argtypes=[ctypes.c_void_p, ctypes.c_char_p, ctypes.c_size_t]
la.archive_read_next_header.argtypes=[ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
la.archive_write_disk_set_options.argtypes=[ctypes.c_void_p, ctypes.c_int]
la.archive_write_header.argtypes=[ctypes.c_void_p, ctypes.c_void_p]
la.archive_write_finish_entry.argtypes=[ctypes.c_void_p]
la.archive_read_data_block.argtypes=[ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(ctypes.c_size_t), ctypes.POINTER(ctypes.c_int64)]
la.archive_write_data_block.argtypes=[ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int64]
src, dst = sys.argv[1], os.path.abspath(sys.argv[2])
a = la.archive_read_new(); la.archive_read_support_filter_all(a); la.archive_read_support_format_all(a)
assert la.archive_read_open_filename(a, src.encode(), 10240) == 0, la.archive_error_string(a)
w = la.archive_write_disk_new(); la.archive_write_disk_set_options(w, 0x100|0x200|0x800)  # secure symlinks/nodotdot/noabsolute
e = ctypes.c_void_p()
while True:
    r = la.archive_read_next_header(a, ctypes.byref(e))
    if r == 1: break
    if r < -10: print("err", la.archive_error_string(a)); break
    p = la.archive_entry_pathname(e).decode(errors="replace"); print(p)
    la.archive_entry_set_pathname(e, os.path.join(dst, p).encode())
    la.archive_write_header(w, e)
    buf=ctypes.c_void_p(); size=ctypes.c_size_t(); off=ctypes.c_int64()
    while la.archive_read_data_block(a, ctypes.byref(buf), ctypes.byref(size), ctypes.byref(off)) == 0:
        la.archive_write_data_block(w, buf, size, off)
    la.archive_write_finish_entry(w)
la.archive_read_free(a); la.archive_write_free(w)
