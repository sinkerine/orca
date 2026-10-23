{
  description = "Orca development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
  };

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-darwin"
        "x86_64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs {
            inherit system;
            config.android_sdk.accept_license = true;
            config.allowUnfree = true;
          };
          node = pkgs.nodejs_24;
          androidSdk =
            (pkgs.androidenv.composeAndroidPackages {
              platformVersions = [ "36" ];
              buildToolsVersions = [ "36.0.0" ];
              cmakeVersions = [ "3.30.5" ];
              includeNDK = true;
              ndkVersions = [ "27.1.12297006" ];
              includeEmulator = true;
              includeSystemImages = true;
              systemImageTypes = [ "google_apis" ];
              abiVersions = [ (if pkgs.stdenv.hostPlatform.isAarch64 then "arm64-v8a" else "x86_64") ];
            }).androidsdk;
          pnpm = pkgs.writeShellScriptBin "pnpm" ''
            exec ${node}/bin/corepack pnpm "$@"
          '';
          linuxRuntimeLibraries = with pkgs; [
            alsa-lib
            atk
            cairo
            cups
            dbus
            expat
            fontconfig
            freetype
            gdk-pixbuf
            glib
            gtk3
            libdrm
            libgbm
            libnotify
            libsecret
            libxkbcommon
            nspr
            nss
            pango
            wayland
            wl-clipboard
            niri
            grim
            wtype
            ydotool
            libx11
            libxcomposite
            libxcursor
            libxdamage
            libxext
            libxfixes
            libxi
            libxinerama
            libxrandr
            libxscrnsaver
            libxtst
            libxcb
            libxshmfence
          ];
        in
        {
          default = pkgs.mkShell {
            packages = [
              node
              pnpm
              pkgs.direnv
              pkgs.git
              pkgs.gnumake
              pkgs.node-gyp
              pkgs.pkg-config
              pkgs.python3
              pkgs.ripgrep
              pkgs.stdenv.cc
              pkgs.jdk17
              androidSdk
            ]
            ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux linuxRuntimeLibraries;

            shellHook =
              pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isLinux ''
                export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath linuxRuntimeLibraries}:''${LD_LIBRARY_PATH:-}"
              ''
              + ''
                export npm_config_node_gyp="${pkgs.node-gyp}/bin/node-gyp"
                export JAVA_HOME="${pkgs.jdk17}"
                export ANDROID_HOME="${androidSdk}/libexec/android-sdk"
                export ANDROID_SDK_ROOT="$ANDROID_HOME"
              '';
          };
        }
      );
    };
}
