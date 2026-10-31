<template>
  <v-toolbar color="primary" dark dense>
    <v-btn v-if="!hideBack" icon @click="$router.go(-1)">
      <v-icon>mdi-chevron-left</v-icon>
    </v-btn>
    <v-toolbar-title :class="{ 'ml-4': hideBack }">
      <span>{{ title }}</span>
      <v-chip
        size="x-small"
        color="white"
        variant="tonal"
        class="ml-2 font-weight-bold"
        style="letter-spacing: 0.5px; opacity: 0.95; font-size: 11px;"
      >
        MTV-2602
      </v-chip>
    </v-toolbar-title>
    <v-spacer></v-spacer>

    <slot />
  </v-toolbar>
</template>
<script>
export default {
  name: "BackHeader",
  props: {
    title: String,
    hideBack: { type: Boolean, default: false },
  },
};
</script>
<style>
.scroll-container {
  height: calc(100vh - 64px);
}
</style>
