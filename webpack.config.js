// @ts-check
"use strict";

const path = require("path");

/** @type {import('webpack').Configuration[]} */
const config = [
  // --- Client ---
  {
    name: "client",
    target: "node",
    mode: "none",
    entry: "./client/src/extension.ts",
    output: {
      path: path.resolve(__dirname, "dist", "client"),
      filename: "extension.js",
      libraryTarget: "commonjs2",
    },
    resolve: {
      extensions: [".ts", ".js"],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: "ts-loader",
        },
      ],
    },
    externals: {
      vscode: "commonjs vscode",
    },
    devtool: "nosources-source-map",
    infrastructureLogging: {
      level: "log",
    },
  },
  // --- Language Server ---
  {
    name: "server",
    target: "node",
    mode: "none",
    entry: "./server/src/server.ts",
    output: {
      path: path.resolve(__dirname, "dist", "server"),
      filename: "server.js",
      libraryTarget: "commonjs2",
    },
    resolve: {
      extensions: [".ts", ".js"],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: "ts-loader",
        },
      ],
    },
    externals: {
      vscode: "commonjs vscode",
    },
    devtool: "nosources-source-map",
    infrastructureLogging: {
      level: "log",
    },
  },
];

module.exports = config;
