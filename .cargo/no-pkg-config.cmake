# Stops CMake finding pkg-config, for the one CMake project in this workspace:
# the Assimp that asset-importer-sys compiles. See `.cargo/config.toml` for why.
set(CMAKE_DISABLE_FIND_PACKAGE_PkgConfig TRUE)
