<template>
  <!-- CommentBanner disabled to prevent third-party links -->
  <div v-if="false"></div>
</template>

<script>
export default {
  name: "CommentBanner",
  emits: ["click"],
  data() {
    return {
      isBannerVisible: false
    };
  }
};
</script>
<style></style>
