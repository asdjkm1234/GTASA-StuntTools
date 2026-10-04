# Build the replay on the development machine before building this runtime image.
# Extract the Node runtime; npm, Yarn, apk and shells do not enter the final image.
FROM node:24-alpine AS node-runtime
FROM scratch
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/LICENSE /NODE-LICENSE
COPY --from=node-runtime /lib/ld-musl-*.so.1 /lib/
COPY --from=node-runtime /usr/lib/libstdc++.so.6* /usr/lib/libgcc_s.so.1 /usr/lib/
COPY --from=node-runtime /etc/passwd /etc/group /etc/
COPY --from=node-runtime /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
WORKDIR /app
ENV PATH=/usr/local/bin NODE_ENV=production NO_OPEN=1 HOST=0.0.0.0 PORT=4173 \
    MAP_PAK_ROOT=/map-pak RECORDINGS_ROOT=/recordings GAME_ROOT=/no-game \
    ENABLE_SERVER_VIDEO_EXPORT=0
COPY web-replay/local-server.mjs web-replay/map-pak-http.mjs web-replay/video-export.mjs ./
# Published site includes the small Windows recorder download, never game assets.
COPY web-replay/dist ./dist
COPY tools/opensa/LICENSE ./OPENSA-LICENSE
USER node
EXPOSE 4173
CMD ["/usr/local/bin/node", "local-server.mjs"]
