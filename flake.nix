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
            config = {
              allowUnfree = true;
              android_sdk.accept_license = true;
            };
          };
          androidAbi = if pkgs.stdenv.hostPlatform.isAarch64 then "arm64-v8a" else "x86_64";
          androidSdk =
            (pkgs.androidenv.composeAndroidPackages {
              platformVersions = [ "36" ];
              buildToolsVersions = [
                "35.0.0"
                "36.0.0"
              ];
              includeEmulator = true;
              includeSystemImages = true;
              systemImageTypes = [ "google_apis" ];
              abiVersions = [ androidAbi ];
              includeNDK = true;
              ndkVersions = [ "27.1.12297006" ];
              cmakeVersions = [ "3.22.1" "3.30.5" ];
            }).androidsdk;
          androidEmulator = pkgs.writeShellApplication {
            name = "orca-android-emulator";
            runtimeInputs = [
              androidSdk
              pkgs.jdk17
            ];
            text = ''
              export ANDROID_HOME="${androidSdk}/libexec/android-sdk"
              export ANDROID_SDK_ROOT="$ANDROID_HOME"
              export ANDROID_USER_HOME="''${ORCA_ANDROID_STATE_DIR:-$PWD/.android-test}"
              export ANDROID_AVD_HOME="$ANDROID_USER_HOME/avd"
              mkdir -p "$ANDROID_AVD_HOME"
              avd_name="orca-feature-api36-${androidAbi}"
              if [ ! -f "$ANDROID_AVD_HOME/$avd_name.ini" ]; then
                echo no | avdmanager create avd --name "$avd_name" \
                  --package 'system-images;android-36;google_apis;${androidAbi}' \
                  --device pixel_7
              fi
              exec emulator -avd "$avd_name" -no-window -no-audio -no-boot-anim \
                -no-snapshot -gpu swiftshader_indirect "$@"
            '';
          };
          node = pkgs.nodejs_24;
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
        rec {
          android = pkgs.mkShell {
            inputsFrom = [ default ];
            packages = [
              androidSdk
              androidEmulator
              pkgs.jdk17
            ];
            ANDROID_HOME = "${androidSdk}/libexec/android-sdk";
            ANDROID_SDK_ROOT = "${androidSdk}/libexec/android-sdk";
            JAVA_HOME = pkgs.jdk17.home;
            GRADLE_OPTS = "-Dorg.gradle.project.android.aapt2FromMavenOverride=${androidSdk}/libexec/android-sdk/build-tools/36.0.0/aapt2";
          };
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
